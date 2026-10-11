import assert from "node:assert/strict";
import test from "node:test";
import { enforceClassifiedDeviceMasks, enforceDatasetDeviceMasks, maskDeviceRows, maskDeviceValue, resolveConfiguredDeviceMasks, resolveDeviceColumnMasks, resolveEffectiveDeviceMasks } from "./dashboardDeviceMasking.js";

test("masks patient name, MRN, and phone before delivery", () => {
  assert.equal(maskDeviceValue("王小佑", "NAME"), "王○佑");
  assert.equal(maskDeviceValue("00001234", "MRN"), "0000○○34");
  assert.equal(maskDeviceValue("0912345678", "PHONE"), "0912○○○678");
  assert.equal(maskDeviceValue(null, "NAME"), null);
  assert.equal(maskDeviceValue("Sensitive", "FULL"), "○○○○");
});

test("resolves masks from default layout", () => {
  const masks = resolveDeviceColumnMasks([{ isDefault: true, widgets: [
    { widgetType: "FIELD", sourceKey: "PatientName", config: { maskMode: "NAME" } },
    { widgetType: "TABLE", sourceKey: null, config: { columnMasks: { MedicalRecordNo: "MRN" } } },
  ] }]);
  assert.deepEqual(masks, { PatientName: "NAME", MedicalRecordNo: "MRN" });
  assert.deepEqual(maskDeviceRows([{ PatientName: "王小佑", MedicalRecordNo: "00001234" }], masks),
    [{ PatientName: "王○佑", MedicalRecordNo: "0000○○34" }]);
  assert.deepEqual(maskDeviceRows([{ PatientName: "王小佑", Diagnosis: "private" }], masks), [{ PatientName: "王○佑" }]);
});

test("accepts custom administrator rules and ignores unknown modes", () => {
  const rules = resolveConfiguredDeviceMasks({ NationalId: "FULL", HealthStatus: "OMIT", Room: "NONE", Unknown: "INVALID" });
  assert.deepEqual(rules, { NationalId: "FULL", HealthStatus: "OMIT", Room: "NONE" });
  assert.deepEqual(maskDeviceRows([{ NationalId: "A123456789", HealthStatus: "private", Room: "OR01", Extra: "private" }], rules),
    [{ NationalId: "○○○○", Room: "OR01" }]);
});

test("layout cannot disclose an unapproved sensitive field", () => {
  const profiles = [{ isDefault: true, widgets: [
    { widgetType: "FIELD", sourceKey: "Diagnosis", config: { maskMode: "NONE" } },
    { widgetType: "TABLE", sourceKey: null, config: { columnMasks: { NationalId: "NONE" } } },
  ] }];
  const masks = resolveEffectiveDeviceMasks({ Room: "NONE", NationalId: "FULL" }, profiles);
  assert.deepEqual(maskDeviceRows([{ Diagnosis: "private", NationalId: "A123456789", Room: "OR01" }], masks),
    [{ NationalId: "○○○○", Room: "OR01" }]);
});

test("classified fields cannot be sent raw even from old saved configuration", () => {
  const masks = enforceClassifiedDeviceMasks({ PAT_ID: "NONE", ROOM_NO: "NONE", HEALTH_STATUS: "FULL" },
    { PAT_ID: "NATIONAL_ID", ROOM_NO: "OTHER", HEALTH_STATUS: "HEALTH" });
  assert.deepEqual(maskDeviceRows([{ PAT_ID: "A123456789", ROOM_NO: "OR01", HEALTH_STATUS: "private" }], masks),
    [{ ROOM_NO: "OR01", HEALTH_STATUS: "○○○○" }]);
});

test("dataset policy overrides weaker dashboard masks", () => {
  const masks = enforceDatasetDeviceMasks({ PAT_ID: "NONE", DIAGNOSIS: "NAME", ROOM: "NONE" }, [
    { columnName: "PAT_ID", sensitivityType: "NATIONAL_ID", deviceMaskMode: "FULL" },
    { columnName: "DIAGNOSIS", sensitivityType: "DIAGNOSIS", deviceMaskMode: "OMIT" },
  ]);
  assert.deepEqual(maskDeviceRows([{ PAT_ID: "A123456789", DIAGNOSIS: "private", ROOM: "OR01" }], masks),
    [{ PAT_ID: "○○○○", ROOM: "OR01" }]);
});
