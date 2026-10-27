import { env } from "../../config/env.js";

/** H0-5C-1 describes future endpoints; no Router imports or registers them. */
export const workstationSessionApiRoutes = Object.freeze([
  { method: "POST", path: "/auth/workstation/device-session", purpose: "DEVICE_SESSION_ISSUE" },
  { method: "POST", path: "/auth/workstation/device-session/renew", purpose: "DEVICE_SESSION_RENEW" },
  { method: "POST", path: "/auth/workstation/operator/lock", purpose: "OPERATOR_LOCK" },
  { method: "POST", path: "/auth/workstation/operator/switch", purpose: "OPERATOR_PIN_SWITCH" },
] as const);

export const workstationSessionCookieContract = Object.freeze({
  name: "__Host-uqp-workstation",
  secure: true,
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  domain: null,
  browserPersistence: "SESSION_COOKIE_ONLY" as const,
  localStorageAllowed: false,
  sessionStorageAllowed: false,
  rawDeviceCredentialAllowed: false,
  rawPinAllowed: false,
});

export const workstationSessionCsrfContract = Object.freeze({
  requireHttps: true,
  requireSameOrigin: true,
  rejectMissingOrigin: true,
  tokenLocation: "MEMORY_ONLY_HEADER" as const,
  tokenHeader: "X-UQP-Workstation-CSRF",
  bindToDeviceSession: true,
  rotateAfterRenewal: true,
  rotateAfterOperatorSwitch: true,
  acceptQueryStringToken: false,
});

export const workstationTokenRotationContract = Object.freeze({
  deviceProofRotation: "EVERY_RENEWAL" as const,
  operatorAuthorizationRotation: "EVERY_SWITCH_OR_REAUTH" as const,
  previousProofReuseAllowed: false,
  commitUnknownAutomaticRetryAllowed: false,
  deviceMayAuthorizeQuery: false,
  operatorJwtIssuanceEnabled: false,
});

export type WorkstationSessionApiGateEvidence = Readonly<{
  schema926Exact: boolean;
  sqlServer2019Accepted: boolean;
  legacyWriterCoverageComplete: boolean;
  httpsAndProxyValidated: boolean;
}>;

const runtimeWired = false as const;

export function assessWorkstationSessionApiGate(evidence: WorkstationSessionApiGateEvidence) {
  const missing = Object.freeze([
    ...(!env.WORKSTATION_SESSION_API_ENABLED ? ["FEATURE_DISABLED" as const] : []),
    ...(!evidence.schema926Exact ? ["SCHEMA_NOT_VERIFIED" as const] : []),
    ...(!evidence.sqlServer2019Accepted ? ["SQL_ACCEPTANCE_NOT_VERIFIED" as const] : []),
    ...(!evidence.legacyWriterCoverageComplete ? ["WRITER_COVERAGE_INCOMPLETE" as const] : []),
    ...(!evidence.httpsAndProxyValidated ? ["HTTPS_PROXY_NOT_VERIFIED" as const] : []),
    ...(!runtimeWired ? ["RUNTIME_NOT_WIRED" as const] : []),
  ]);
  return Object.freeze({
    enabled: false as const,
    status: "BLOCKED" as const,
    missing,
    authority: "NONE" as const,
    jwtIssued: false as const,
    queryExecutionAllowed: false as const,
    patientDataAllowed: false as const,
  });
}

export const workstationSessionApiRuntimeWired = runtimeWired;
