import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardPatientAudit, type DisclosureContext } from "./patientDisclosure.service.js";
import { hashPatientForDisclosure } from "./patientAuditKeyring.js";

test("Dashboard validates actual exact aliases and HMAC identities; audit errors cannot return data", async () => {
  let calls = 0; let unavailable = false;
  const keyring = { activeVersion: 1, versions: new Map([[1, Buffer.alloc(32, 5)]]) };
  const audit = createDashboardPatientAudit(async () => {
    if (unavailable) throw new Error("synthetic-unavailable");
    return { config: { isEnabled: true, patientKeyColumn: "MRN", version: "1" }, keyring };
  }, async input => {
    calls++;
    for (const row of input.rows) assert.equal(hashPatientForDisclosure(row.MRN, input.sourceScope, input.keyring).patientKeyHash.length, 32);
    return 7;
  });
  const context: DisclosureContext = { datasetId: 1, userId: 2, deliveryType: "DASHBOARD", sourceScope: "synthetic", masked: true, rows: [{ MRN: "synthetic-1" }] };
  assert.equal(await audit(context), 7);
  for (const row of [{ mrn: "synthetic-1" }, { MRN: "synthetic-1", mrn: "synthetic-2" }, { MRN: null }, { MRN: "" }, { MRN: Infinity }, { MRN: NaN }])
    await assert.rejects(audit({ ...context, rows: [row] }));
  unavailable = true; await assert.rejects(audit(context));
  assert.equal(await audit({ ...context, rows: [] }), null);
  const failAudit = createDashboardPatientAudit(async () => ({ config: { isEnabled: true, patientKeyColumn: "MRN", version: "1" }, keyring }), async () => { throw new Error("synthetic-persistence-failure"); });
  await assert.rejects(failAudit(context)); assert.ok(calls > 0);
});
