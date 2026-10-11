import assert from "node:assert/strict";
import test from "node:test";
import { maskDeviceRows, maskDeviceValue, resolveDeviceColumnMasks } from "./dashboardDeviceMasking.js";

test("masks patient name, MRN, and phone before delivery", () => {
  assert.equal(maskDeviceValue("王小佑", "NAME"), "王○佑");
  assert.equal(maskDeviceValue("00001234", "MRN"), "0000○○34");
  assert.equal(maskDeviceValue("0912345678", "PHONE"), "0912○○○678");
  assert.equal(maskDeviceValue(null, "NAME"), null);
});

test("resolves masks from default layout", () => {
  const masks = resolveDeviceColumnMasks([{ isDefault: true, widgets: [
    { widgetType: "FIELD", sourceKey: "PatientName", config: { maskMode: "NAME" } },
    { widgetType: "TABLE", sourceKey: null, config: { columnMasks: { MedicalRecordNo: "MRN" } } },
  ] }]);
  assert.deepEqual(masks, { PatientName: "NAME", MedicalRecordNo: "MRN" });
  assert.deepEqual(maskDeviceRows([{ PatientName: "王小佑", MedicalRecordNo: "00001234" }], masks),
    [{ PatientName: "王○佑", MedicalRecordNo: "0000○○34" }]);
});
