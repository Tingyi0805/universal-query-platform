import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assessWorkstationSessionApiGate,
  workstationSessionApiRoutes,
  workstationSessionApiRuntimeWired,
  workstationSessionCookieContract,
  workstationSessionCsrfContract,
  workstationTokenRotationContract,
} from "./workstationSessionApiContract.js";

test("future Session/PIN endpoints remain unregistered and permanently non-authoritative in H0-5C-1", async () => {
  assert.equal(workstationSessionApiRuntimeWired, false);
  assert.equal(workstationSessionApiRoutes.length, 4);
  const authRoutes = await readFile(new URL("./auth.routes.ts", import.meta.url), "utf8");
  for (const route of workstationSessionApiRoutes) assert.equal(authRoutes.includes(route.path), false);
  assert.equal(authRoutes.includes("workstationSessionApiContract"), false);
  const result = assessWorkstationSessionApiGate({
    schema926Exact: true, sqlServer2019Accepted: true,
    legacyWriterCoverageComplete: true, httpsAndProxyValidated: true,
  });
  assert.equal(result.enabled, false);
  assert.equal(result.authority, "NONE");
  assert.equal(result.jwtIssued, false);
  assert.ok(result.missing.includes("RUNTIME_NOT_WIRED"));
});

test("feature flag defaults off and missing evidence is explicit", async () => {
  const envSource = await readFile(new URL("../../config/env.ts", import.meta.url), "utf8");
  assert.match(envSource, /WORKSTATION_SESSION_API_ENABLED: envBoolean\(false\)/u);
  const result = assessWorkstationSessionApiGate({
    schema926Exact: false, sqlServer2019Accepted: false,
    legacyWriterCoverageComplete: false, httpsAndProxyValidated: false,
  });
  for (const reason of [
    "SCHEMA_NOT_VERIFIED", "SQL_ACCEPTANCE_NOT_VERIFIED", "WRITER_COVERAGE_INCOMPLETE",
    "HTTPS_PROXY_NOT_VERIFIED", "RUNTIME_NOT_WIRED",
  ] as const) assert.ok(result.missing.includes(reason));
  assert.equal(result.enabled, false);
});

test("cookie, CSRF and rotation contracts prohibit browser-persistent long-lived secrets", () => {
  assert.deepEqual(workstationSessionCookieContract, {
    name: "__Host-uqp-workstation", secure: true, httpOnly: true, sameSite: "strict",
    path: "/", domain: null, browserPersistence: "SESSION_COOKIE_ONLY",
    localStorageAllowed: false, sessionStorageAllowed: false,
    rawDeviceCredentialAllowed: false, rawPinAllowed: false,
  });
  assert.equal(workstationSessionCsrfContract.requireHttps, true);
  assert.equal(workstationSessionCsrfContract.requireSameOrigin, true);
  assert.equal(workstationSessionCsrfContract.tokenLocation, "MEMORY_ONLY_HEADER");
  assert.equal(workstationSessionCsrfContract.acceptQueryStringToken, false);
  assert.equal(workstationTokenRotationContract.previousProofReuseAllowed, false);
  assert.equal(workstationTokenRotationContract.commitUnknownAutomaticRetryAllowed, false);
  assert.equal(workstationTokenRotationContract.deviceMayAuthorizeQuery, false);
  assert.equal(workstationTokenRotationContract.operatorJwtIssuanceEnabled, false);
});
