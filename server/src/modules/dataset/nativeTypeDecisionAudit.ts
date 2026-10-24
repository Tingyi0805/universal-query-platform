import { types } from "node:util";
import { z } from "zod";

// Synthetic consistency only. No SQL, persistence receipt, issuer, or runtime permission.
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape).strict();
const id = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n);
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const rv = z.string().regex(/^[a-f0-9]{16}$/).refine(v => v !== "0000000000000000");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const state = z.enum(["PENDING", "CONFIRMED", "REJECTED", "REVOKED", "INVALIDATED"]);
const action = z.enum(["CONFIRM", "REJECT", "REVOKE", "INVALIDATE"]);
const reason = z.enum(["REVIEW_ACCEPTED", "REVIEW_REJECTED", "AUTHORIZATION_REVOKED", "EVIDENCE_INVALIDATED"]);
const receiptSchema = object({ auditId: id }); // Same shape as B2; no production interface replacement.
const integrity = object({
  sql: object({ format: z.literal("SQL_UTF8_EXACT_V1"), digest }),
  parameterDefinition: object({ format: z.literal("SAVED_PARAMETER_SNAPSHOT_V1"), digest }),
  nativeTypes: object({ format: z.literal("NATIVE_TYPES_V1"), digest }),
});
const relationship = {
  decisionId: id, reviewId: uuid, requestId: uuid, actorId: id, action, reasonCode: reason,
  previousState: state, nextState: state, previousStateRowVersion: rv, nextStateRowVersion: rv,
  snapshotIntegrity: integrity, auditLogId: id, transactionCorrelationReference: uuid,
};
const decisionSchema = object({ format: z.literal("SYNTHETIC_NATIVE_TYPE_DECISION_V1"), ...relationship });
const auditSchema = object({ format: z.literal("SYNTHETIC_NATIVE_TYPE_AUDIT_V1"), ...relationship,
  eventType: z.literal("DATASET_NATIVE_TYPE_DECISION"), eventStatus: z.enum(["SUCCESS", "FAILED", "STARTED"]) });
const auditObservation = z.discriminatedUnion("location", [
  object({ location: z.literal("ONLINE"), record: auditSchema }),
  object({ location: z.literal("ARCHIVE"), record: auditSchema }),
  object({ location: z.literal("MISSING"), auditLogId: id }),
  object({ location: z.literal("PURGED"), auditLogId: id }),
]);
const inputSchema = object({
  scope: z.literal("SYNTHETIC_TEST_ONLY"), decision: decisionSchema, audit: auditObservation,
  receipt: receiptSchema,
  cas: object({ reviewId: uuid, previousState: state, nextState: state,
    previousStateRowVersion: rv, nextStateRowVersion: rv, affectedRows: z.literal(1) }),
  requestHistory: object({ scope: z.literal("COMPLETE_SYNTHETIC_LEDGER"), decisions: z.array(decisionSchema).max(100) }),
});

export type SyntheticNativeTypeDecision = z.infer<typeof decisionSchema>;
export type SyntheticDecisionAuditInput = z.infer<typeof inputSchema>;
export type DecisionAuditReason = "FORMAT_INVALID" | "RELATIONSHIP_MISMATCH" | "CAS_CONFLICT"
  | "STATE_TRANSITION_INVALID" | "ATTEMPT_NOT_SUCCESSFUL" | "REQUEST_REPLAY" | "REQUEST_COLLISION"
  | "HISTORY_CONFLICT" | "AUDIT_HISTORY_UNAVAILABLE";
const restrictions = { authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false,
  persistence: "NOT_PROVEN" } as const;

// Inspect own data descriptors before parsing. Never invoke caller getters/toJSON/proxy traps.
function dataSnapshot(input: unknown): unknown {
  let nodes = 0;
  const copy = (v: unknown, depth: number): unknown => {
    if (++nodes > 10000 || depth > 12) throw new Error();
    if (typeof v === "string") { if (v.length > 128) throw new Error(); return v; }
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v !== "object" || types.isProxy(v)) throw new Error();
    const proto = Object.getPrototypeOf(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.getOwnPropertySymbols(v).length) throw new Error();
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 100 || Object.keys(descriptors).length !== v.length + 1) throw new Error();
      return Array.from({ length: v.length }, (_, i) => {
        const d = descriptors[String(i)];
        if (!d || !("value" in d) || !d.enumerable) throw new Error();
        return copy(d.value, depth + 1);
      });
    }
    if (proto !== Object.prototype && proto !== null || Object.keys(descriptors).length > 24) throw new Error();
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, d] of Object.entries(descriptors)) {
      if (!("value" in d) || !d.enumerable) throw new Error();
      out[key] = copy(d.value, depth + 1);
    }
    return out;
  };
  return copy(input, 0);
}

export function validateSyntheticAuditReceipt(input: unknown) {
  let formatValid = false;
  try { formatValid = receiptSchema.safeParse(dataSnapshot(input)).success; } catch { /* fixed result only */ }
  return Object.freeze({ kind: "ISOLATED_AUDIT_RECEIPT_FORMAT" as const, formatValid, ...restrictions });
}

const transitions = {
  CONFIRM: { from: "PENDING", to: "CONFIRMED", reason: "REVIEW_ACCEPTED" },
  REJECT: { from: "PENDING", to: "REJECTED", reason: "REVIEW_REJECTED" },
  REVOKE: { from: "CONFIRMED", to: "REVOKED", reason: "AUTHORIZATION_REVOKED" },
  INVALIDATE: { from: null, to: "INVALIDATED", reason: "EVIDENCE_INVALIDATED" },
} as const;
function validTransition(d: SyntheticNativeTypeDecision): boolean {
  const t = transitions[d.action];
  return (t.from === null ? d.previousState === "PENDING" || d.previousState === "CONFIRMED" : d.previousState === t.from)
    && d.nextState === t.to && d.reasonCode === t.reason
    && BigInt(`0x${d.nextStateRowVersion}`) > BigInt(`0x${d.previousStateRowVersion}`);
}
function sameRelationship(a: SyntheticNativeTypeDecision, b: z.infer<typeof auditSchema>): boolean {
  return Object.keys(relationship).every(key => {
    const field = key as keyof typeof relationship;
    return JSON.stringify(a[field]) === JSON.stringify(b[field]);
  });
}

/** Checks supplied synthetic projections, not their authenticity, SQL atomicity or durable existence. */
export function validateSyntheticDecisionAudit(input: unknown) {
  const result = (reasonCode: DecisionAuditReason | null) => Object.freeze({
    kind: "ISOLATED_DECISION_AUDIT_CONSISTENCY" as const, consistent: reasonCode === null,
    reason: reasonCode, ...restrictions,
  });
  try {
    const parsed = inputSchema.safeParse(dataSnapshot(input));
    if (!parsed.success) return result("FORMAT_INVALID");
    const { decision: d, audit, receipt, cas, requestHistory } = parsed.data;
    if (!validTransition(d)) return result("STATE_TRANSITION_INVALID");
    if (cas.reviewId !== d.reviewId || cas.previousState !== d.previousState || cas.nextState !== d.nextState
      || cas.previousStateRowVersion !== d.previousStateRowVersion || cas.nextStateRowVersion !== d.nextStateRowVersion)
      return result("CAS_CONFLICT");
    const requests = new Set<string>(), decisions = new Set<string>(), auditIds = new Set<string>();
    for (const prior of requestHistory.decisions) {
      if (!validTransition(prior) || requests.has(prior.requestId) || decisions.has(prior.decisionId) || auditIds.has(prior.auditLogId))
        return result("HISTORY_CONFLICT");
      requests.add(prior.requestId); decisions.add(prior.decisionId); auditIds.add(prior.auditLogId);
    }
    const prior = requestHistory.decisions.find(v => v.requestId === d.requestId);
    if (prior) return result(JSON.stringify(prior) === JSON.stringify(d) ? "REQUEST_REPLAY" : "REQUEST_COLLISION");
    if (decisions.has(d.decisionId) || auditIds.has(d.auditLogId)) return result("HISTORY_CONFLICT");
    const chains = new Map<string, SyntheticNativeTypeDecision[]>();
    for (const entry of requestHistory.decisions) {
      const chain = chains.get(entry.reviewId) ?? [];
      chain.push(entry); chains.set(entry.reviewId, chain);
    }
    for (const chain of chains.values()) {
      chain.sort((a, b) => a.previousStateRowVersion < b.previousStateRowVersion ? -1 : a.previousStateRowVersion === b.previousStateRowVersion ? 0 : 1);
      if (chain[0]!.previousState !== "PENDING") return result("HISTORY_CONFLICT");
      for (let i = 1; i < chain.length; i++) {
        const before = chain[i - 1]!, after = chain[i]!;
        if (before.nextState !== after.previousState || before.nextStateRowVersion !== after.previousStateRowVersion
          || JSON.stringify(before.snapshotIntegrity) !== JSON.stringify(after.snapshotIntegrity)) return result("HISTORY_CONFLICT");
      }
    }
    const chain = chains.get(d.reviewId), latest = chain?.[chain.length - 1];
    if (latest ? latest.nextState !== d.previousState || latest.nextStateRowVersion !== d.previousStateRowVersion
      || JSON.stringify(latest.snapshotIntegrity) !== JSON.stringify(d.snapshotIntegrity) : d.previousState !== "PENDING")
      return result("CAS_CONFLICT");
    if (audit.location === "MISSING" || audit.location === "PURGED") return result("AUDIT_HISTORY_UNAVAILABLE");
    if (audit.record.eventStatus !== "SUCCESS") return result("ATTEMPT_NOT_SUCCESSFUL");
    if (receipt.auditId !== d.auditLogId || !sameRelationship(d, audit.record)) return result("RELATIONSHIP_MISMATCH");
    return result(null);
  } catch { return result("FORMAT_INVALID"); }
}
