/** 4B-2 operator isolation checklist validator. Offline metadata only; never connects or grants approval. */
export type IsolationChecklist = {
  profile: "legacy" | "coexistence";
  runId: string;
  target: { host: string; port: number; database: string };
  evidence: {
    dedicatedInstanceId: string;
    localEndpointVerified: boolean;
    noForwardingVerified: boolean;
    separateNetworkVerified: boolean;
    separateVolumeVerified: boolean;
    noSharedMountVerified: boolean;
    independentCredentialsVerified: boolean;
    syntheticDataOnlyVerified: boolean;
    noExternalSourcesVerified: boolean;
    backupRestorePlanReviewed: boolean;
    operatorReviewed: boolean;
  };
};
const checks = [
  "localEndpointVerified", "noForwardingVerified", "separateNetworkVerified",
  "separateVolumeVerified", "noSharedMountVerified", "independentCredentialsVerified",
  "syntheticDataOnlyVerified", "noExternalSourcesVerified",
  "backupRestorePlanReviewed", "operatorReviewed",
] as const;
export function reviewIsolationChecklist(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("ISOLATION_CHECKLIST_INVALID");
  const o = input as Partial<IsolationChecklist>;
  if (o.profile !== "legacy" && o.profile !== "coexistence") throw new Error("ISOLATION_PROFILE_INVALID");
  if (typeof o.runId !== "string" || !/^[a-f0-9]{12}$/.test(o.runId)) throw new Error("ISOLATION_RUN_ID_INVALID");
  const t = o.target;
  if (!t || t.host !== "127.0.0.1" || !Number.isInteger(t.port) || t.port < 14330 || t.port > 65535 ||
      t.database !== `UQP_ACCEPT_${o.runId}`) throw new Error("ISOLATION_TARGET_INVALID");
  const e = o.evidence;
  if (!e || typeof e.dedicatedInstanceId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(e.dedicatedInstanceId)) {
    throw new Error("ISOLATION_INSTANCE_INVALID");
  }
  const missing = checks.filter(key => e[key] !== true);
  return {
    checklistComplete: missing.length === 0,
    missing,
    selfReportedOnly: true,
    verifiedByDatabase: false,
    authorizesConnection: false,
    authorizesMigration: false,
    warning: "Operator assertions require independent verification; this module does not connect to SQL Server.",
  };
}
