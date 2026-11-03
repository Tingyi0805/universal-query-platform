import { createHmac, randomUUID } from "node:crypto";
import type sql from "mssql";
import { env } from "../../config/env.js";
import { writeAuditEvent, type AuditStartInput } from "../audit/audit.repository.js";
import { createDeviceSecret } from "./workstationCredential.service.js";
import { parsePinPepper, verifyPin } from "./pinVerifier.js";
import { createWorkstationPinState, pinAttemptBuckets } from "./workstationPinState.repository.js";
import { workstationSessions } from "./workstationSession.repository.js";

const defaults = {
  enabled: () => env.WORKSTATION_PIN_RUNTIME,
  pepper: () => parsePinPepper(env.WORKSTATION_PIN_PEPPER_ID, env.WORKSTATION_PIN_PEPPER),
  sessions: workstationSessions, state: createWorkstationPinState(), verify: verifyPin, audit: writeAuditEvent,
  token: () => `${randomUUID()}.${createDeviceSecret()}`,
};
export function createWorkstationPinService(deps = defaults) {
  function requireRuntime() {
    if (!deps.enabled()) throw new Error("PIN_RUNTIME_DISABLED");
    return deps.pepper();
  }
  async function login(input: { credential: string; username: string; pin: string; network: string; audit?: Partial<AuditStartInput> }) {
    const pepper = requireRuntime();
    const binding = await deps.sessions.credential(input.credential);
    if (!binding) throw new Error("PIN_CREDENTIAL_INVALID");
    const audit = (eventType: string, tx: sql.Transaction, userId?: number, errorCode?: string) => deps.audit({
      ...input.audit, eventType, userId: userId ?? null, status: errorCode ? "FAILED" : "SUCCESS", errorCode,
      parameters: { workstationId: binding.workstationId },
    }, tx);
    // Phase one is durable before reading B's verifier. Even malformed/incorrect
    // credentials for B cannot undo this committed revocation of A.
    const generation = await deps.state.revokeForIntent(binding.workstationId, async tx => {
      const current = await deps.sessions.credential(input.credential, tx);
      if (!current || current.workstationId !== binding.workstationId || current.credentialVersion !== binding.credentialVersion)
        throw new Error("PIN_CREDENTIAL_INVALID");
      await audit("AUTH_PIN_SWITCH_REVOKED", tx);
    });
    const attemptKey = createHmac("sha256", pepper.key).update("uqp:pin-attempt-key:v1").digest();
    const canonicalAccount = await deps.sessions.accountBucketIdentity(input.username);
    const buckets = pinAttemptBuckets(canonicalAccount, binding.workstationId, input.network, attemptKey);
    const token = deps.token();
    const status = await deps.state.attempt(buckets, async tx => {
      const current = await deps.sessions.credential(input.credential, tx);
      if (!current || current.credentialVersion !== binding.credentialVersion || current.generation !== generation)
        throw new Error("PIN_SWITCH_STALE");
      const user = await deps.sessions.candidate(input.username.trim(), current, tx);
      const valid = !!user && Number.isInteger(user.PinLength) && user.PinLength >= 4 && user.PinLength <= 12
        && input.pin.length === user.PinLength && await deps.verify(input.pin, String(user.PinHash), pepper);
      if (!valid) { await audit("AUTH_PIN_LOGIN_FAILED", tx, undefined, "PIN_INVALID"); return false; }
      if (!await deps.state.claimGeneration(tx, binding.workstationId, generation)) throw new Error("PIN_SWITCH_STALE");
      await deps.sessions.insert(token, input.credential, current, user, tx);
      await audit("AUTH_PIN_LOGIN_SUCCESS", tx, Number(user.Id));
      return true;
    });
    if (status === "LOCKED") await deps.state.transaction(tx => audit("AUTH_PIN_LOGIN_LOCKED", tx, undefined, "PIN_LOCKED"));
    // Never return a token for a rolled-back insert/Audit or failed verification.
    return status === "OK" ? { status, token } as const : { status } as const;
  }
  async function lock(credential: string, context?: Partial<AuditStartInput>) {
    requireRuntime();
    const binding = await deps.sessions.credential(credential);
    if (!binding) throw new Error("PIN_CREDENTIAL_INVALID");
    await deps.state.revokeForIntent(binding.workstationId, async tx => {
      const current = await deps.sessions.credential(credential, tx);
      if (!current || current.credentialVersion !== binding.credentialVersion) throw new Error("PIN_CREDENTIAL_INVALID");
      await deps.audit({ ...context, eventType: "AUTH_PIN_LOCK", parameters: { workstationId: binding.workstationId } }, tx);
    });
  }
  async function activity(token: string, credential: string) {
    requireRuntime();
    return deps.state.transaction(tx => deps.sessions.touch(token, credential, tx));
  }
  async function current(token: string | null, credential: string, context?: Partial<AuditStartInput>) {
    requireRuntime();
    return deps.state.transaction(async tx => {
      const binding = await deps.sessions.credential(credential, tx);
      if (!binding) throw new Error("PIN_CREDENTIAL_INVALID");
      const expired = await deps.sessions.expire(binding, tx);
      for (const userId of expired) await deps.audit({ ...context, eventType: "AUTH_PIN_IDLE_LOCKED", userId,
        parameters: { workstationId: binding.workstationId } }, tx);
      return token ? deps.sessions.read(token, credential, tx) : null;
    });
  }
  return { login, lock, activity, current };
}
export const workstationPinService = createWorkstationPinService();
