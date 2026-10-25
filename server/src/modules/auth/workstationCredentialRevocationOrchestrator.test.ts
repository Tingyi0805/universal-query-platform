import assert from "node:assert/strict";
import test from "node:test";
import {
  executeIsolatedCredentialRevocation,
  isolatedRevocationTransactionAvailability,
  type IsolatedRevocationTransactionFactory,
} from "./workstationCredentialRevocationOrchestrator.js";
import type { CredentialRevocationEvidence } from "./workstationCredentialRevocationFence.js";

function evidence(): CredentialRevocationEvidence {
  return {
    credentialMutationAffected: 1, expectedCredentialVersionMatched: true,
    deviceSessionsLocked: 2, deviceSessionsRevoked: 2, deviceSessionsRemaining: 0,
    legacySessionsLocked: 1, legacySessionsRevoked: 1, legacySessionsRemaining: 0,
    operatorStatePresent: true, operatorCasAffected: 1,
    operatorGenerationAdvanced: true, operatorIncarnationRotated: true,
    requestReservationAffected: 1, auditAffected: 1, decisionAffected: 1,
    auditLogId: "9007199254740993", commitOutcome: "UNKNOWN",
  };
}

function makeFactory(options: {
  value?: CredentialRevocationEvidence;
  failOpen?: boolean;
  failWork?: boolean;
  failCommit?: boolean;
  failRollback?: boolean;
} = {}) {
  const calls: string[] = [];
  const factory: IsolatedRevocationTransactionFactory = {
    async openSerializableWithSecurityGate() {
      calls.push("open");
      if (options.failOpen) throw new Error("OPEN_FAILED");
      return {
        async revokeCredentialAndDependents() {
          calls.push("work");
          if (options.failWork) throw new Error("WORK_FAILED");
          return options.value ?? evidence();
        },
        async commit() {
          calls.push("commit");
          if (options.failCommit) throw new Error("COMMIT_ACK_LOST");
        },
        async rollback() {
          calls.push("rollback");
          if (options.failRollback) throw new Error("ROLLBACK_FAILED");
        },
      };
    },
  };
  return { calls, factory };
}

test("isolated orchestration orders work then commit and never grants authority", async () => {
  const { calls, factory } = makeFactory();
  const result = await executeIsolatedCredentialRevocation(factory);
  assert.deepEqual(calls, ["open", "work", "commit"]);
  assert.equal(result.status, "COMMITTED_SYNTHETIC");
  assert.equal(result.authority, "NONE");
  assert.equal(result.runtimeEnabled, false);
  assert.equal(isolatedRevocationTransactionAvailability.routesConnected, false);
});

test("partial invalidation and absent immutable audit abort before commit", async () => {
  for (const value of [
    { ...evidence(), deviceSessionsRevoked: 1 },
    { ...evidence(), legacySessionsRemaining: 1 },
    { ...evidence(), operatorGenerationAdvanced: false },
    { ...evidence(), auditAffected: 0 },
    { ...evidence(), decisionAffected: 0 },
    { ...evidence(), commitOutcome: "COMMITTED" as const },
  ]) {
    const { calls, factory } = makeFactory({ value });
    const result = await executeIsolatedCredentialRevocation(factory);
    assert.equal(result.status, "REJECTED");
    assert.deepEqual(calls, ["open", "work", "rollback"]);
  }
});

test("failed acquisition or work cannot commit; rollback failure is distinct", async () => {
  const failedOpen = makeFactory({ failOpen: true });
  assert.equal((await executeIsolatedCredentialRevocation(failedOpen.factory)).status, "REJECTED");
  assert.deepEqual(failedOpen.calls, ["open"]);
  const failedWork = makeFactory({ failWork: true });
  assert.equal((await executeIsolatedCredentialRevocation(failedWork.factory)).status, "REJECTED");
  assert.deepEqual(failedWork.calls, ["open", "work", "rollback"]);
  const failedRollback = makeFactory({ failWork: true, failRollback: true });
  assert.equal((await executeIsolatedCredentialRevocation(failedRollback.factory)).status, "ROLLBACK_UNKNOWN");
});

test("commit error is UNKNOWN without rollback or blind retry", async () => {
  const { calls, factory } = makeFactory({ failCommit: true });
  assert.equal((await executeIsolatedCredentialRevocation(factory)).status, "COMMIT_UNKNOWN");
  assert.deepEqual(calls, ["open", "work", "commit"]);
});
