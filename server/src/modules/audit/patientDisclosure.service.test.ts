import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardPatientAudit } from "./patientDisclosure.service.js";

const input = { datasetId: 7, queryDefinitionId: 9, userId: 2, dashboardDeviceId: null,
  sourceScope: "synthetic", deliveryType: "PAGE" as const, pageNumber: 1,
  masked: true, rows: [{ 姓名: "合○甲", 手術室: "OR-1" }] };

test("Dashboard ordinary Dataset with no patient-audit contract does not require patient-only confirmation", async () => {
  let confirmations = 0, writes = 0;
  const audit = createDashboardPatientAudit(async () => { confirmations++; throw new Error("unexpected confirmation"); },
    async () => { writes++; return 1; }, async () => null);
  assert.equal(await audit(input), null);
  assert.equal(confirmations, 0); assert.equal(writes, 0);
});

test("Dashboard explicitly disabled patient-audit contract does not force patient disclosure", async () => {
  const audit = createDashboardPatientAudit(async () => { throw new Error("unexpected confirmation"); },
    async () => { throw new Error("unexpected disclosure"); }, async () => ({ isEnabled: false, patientKeyColumn: "MRN" }));
  assert.equal(await audit(input), null);
});

test("Dashboard enabled patient-audit contract must validate its trusted confirmation", async () => {
  let confirmed = 0, written = 0;
  const audit = createDashboardPatientAudit(async () => { confirmed++; throw new Error("PATIENT_AUDIT_NOT_CONFIRMED"); },
    async () => { written++; return 1; }, async () => ({ isEnabled: true, patientKeyColumn: "MRN" }));
  await assert.rejects(audit(input), /PATIENT_AUDIT_NOT_CONFIRMED/);
  assert.equal(confirmed, 1); assert.equal(written, 0);
});

test("Dashboard empty result never creates patient-list disclosure", async () => {
  const audit = createDashboardPatientAudit(async () => { throw new Error("unexpected confirmation"); },
    async () => { throw new Error("unexpected disclosure"); }, async () => { throw new Error("unexpected configuration"); });
  assert.equal(await audit({ ...input, rows: [] }), null);
});
