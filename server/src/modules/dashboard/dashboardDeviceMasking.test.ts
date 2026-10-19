import assert from "node:assert/strict";
import test from "node:test";
import { enforceClassifiedDeviceMasks, enforceDatasetDeviceMasks, maskDeviceRows, maskDeviceValue, resolveConfiguredDeviceMasks, resolveDeviceColumnMasks, resolveEffectiveDeviceMasks, resolveSupplementalDeviceRules } from "./dashboardDeviceMasking.js";

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

test("dataset classification alone does not grant a field to device playback", () => {
  const masks = enforceDatasetDeviceMasks({ ROOM: "NONE" }, [
    { columnName: "PAT_ID", sensitivityType: "NATIONAL_ID", deviceMaskMode: "FULL" },
  ]);
  assert.deepEqual(maskDeviceRows([{ PAT_ID: "A123456789", ROOM: "OR01" }], masks), [{ ROOM: "OR01" }]);
});

test("mask conflicts preserve stronger protection", () => {
  const rules = [{ columnName: "PAT_ID", sensitivityType: "NATIONAL_ID", deviceMaskMode: "MRN" as const }];
  assert.equal(enforceDatasetDeviceMasks({ PAT_ID: "FULL" }, rules).PAT_ID, "FULL");
  assert.equal(enforceDatasetDeviceMasks({ PAT_ID: "NAME" }, rules).PAT_ID, "FULL");
  assert.equal(enforceDatasetDeviceMasks({ PAT_ID: "NONE" }, rules).PAT_ID, "MRN");
  assert.equal(enforceDatasetDeviceMasks({ PAT_ID: "OMIT" }, rules).PAT_ID, "OMIT");
});


test("dataset rules apply despite column-name case differences", () => {
  const masks = enforceDatasetDeviceMasks({ PAT_ID: "NONE", ROOM: "NONE" }, [
    { columnName: "pat_id", sensitivityType: "NATIONAL_ID", deviceMaskMode: "FULL" },
  ]);
  assert.deepEqual(maskDeviceRows([{ PAT_ID: "A123456789", ROOM: "OR01" }], masks),
    [{ PAT_ID: "○○○○", ROOM: "OR01" }]);
});

test("dataset rules never add an unapproved field even with different casing", () => {
  const masks = enforceDatasetDeviceMasks({ ROOM: "NONE" }, [
    { columnName: "pat_id", sensitivityType: "NATIONAL_ID", deviceMaskMode: "FULL" },
  ]);
  assert.deepEqual(maskDeviceRows([{ PAT_ID: "A123456789", ROOM: "OR01" }], masks),
    [{ ROOM: "OR01" }]);
});


test("device row masking matches approved columns case-insensitively", () => {
  const masks = { PAT_ID: "FULL" as const, ROOM: "NONE" as const };
  assert.deepEqual(maskDeviceRows([{ pat_id: "A123456789", room: "OR01", extra: "secret" }], masks),
    [{ pat_id: "○○○○", room: "OR01" }]);
});

test("ambiguous case-insensitive dashboard approvals are denied", () => {
  const masks = { PAT_ID: "NONE" as const, pat_id: "FULL" as const };
  assert.deepEqual(maskDeviceRows([{ PAT_ID: "A123456789", pat_id: "B123456789" }], masks), [{}]);
});

test("custom masks support prefix/suffix and custom symbol", () => {
  assert.equal(maskDeviceValue("00001234", "CUSTOM", { prefix: 0, suffix: 4, symbol: "*" }), "****1234");
  assert.equal(maskDeviceValue("0912345678", "CUSTOM", { prefix: 3, suffix: 3, symbol: "*" }), "091****678");
  assert.equal(maskDeviceValue("王小明", "CUSTOM", { prefix: 1, suffix: 1, symbol: "○" }), "王○明");
});

test("custom mask invalid config and short values fail closed", () => {
  assert.equal(maskDeviceValue("1234", "CUSTOM"), "○○○○");
  assert.equal(maskDeviceValue("123", "CUSTOM", { prefix: 3, suffix: 3, symbol: "*" }), "***");
  assert.equal(maskDeviceValue("1234", "CUSTOM", { prefix: 1, suffix: 1, symbol: "**" }), "○○○○");
});

test("dataset custom masking applies to page rows without granting new columns", () => {
  const rules = [{ columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "CUSTOM" as const,
    customMask: { prefix: 0, suffix: 4, symbol: "*" } }];
  const masks = enforceDatasetDeviceMasks({ MRN: "NONE" }, rules);
  assert.deepEqual(maskDeviceRows([{ MRN: "00001234", HIDDEN: "private" }], masks, rules),
    [{ MRN: "****1234" }]);
});

test("case-insensitive classified fields, conflicting CUSTOM masks and null omission fail closed", () => {
  assert.equal(enforceClassifiedDeviceMasks({ NAME: "NONE" }, { name: "NAME" }).NAME, "OMIT");
  assert.equal(enforceDatasetDeviceMasks({ MRN: "MRN" }, [
    { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "CUSTOM" },
  ]).MRN, "FULL");
  assert.equal(maskDeviceValue(null, "OMIT"), undefined);
});
test("CUSTOM accepts ordinary letters and emoji, rejects actual control characters", () => {
  for (const symbol of ["r", "n", "t", "😀"]) assert.equal(maskDeviceValue("1234", "CUSTOM", { prefix: 1, suffix: 1, symbol }), `1${symbol}${symbol}4`);
  for (const symbol of ["\r", "\n", "\t"]) assert.equal(maskDeviceValue("1234", "CUSTOM", { prefix: 1, suffix: 1, symbol }), "○○○○");
});
test("ambiguous supplemental rules are omitted regardless of input order", () => {
  for (const rules of [
    [{ columnName: "NAME", deviceMaskMode: "NONE" as const }, { columnName: "name", deviceMaskMode: "NAME" as const }],
    [{ columnName: "name", deviceMaskMode: "NAME" as const }, { columnName: "NAME", deviceMaskMode: "NONE" as const }],
  ]) assert.equal(resolveSupplementalDeviceRules(rules).size, 0);
});
test("simplified editor OTHER rules still enforce CUSTOM and FULL over raw dashboard approval", () => {
  const rules = [
    { columnName: "MRN", sensitivityType: "OTHER", deviceMaskMode: "CUSTOM" as const, customMask: { prefix: 0, suffix: 2, symbol: "*" } },
    { columnName: "NAME", sensitivityType: "OTHER", deviceMaskMode: "FULL" as const },
  ];
  const masks = enforceDatasetDeviceMasks({ MRN: "NONE", NAME: "NONE" }, rules);
  assert.deepEqual(maskDeviceRows([{ MRN: "00000123", NAME: "合成患者" }], masks, rules), [{ MRN: "******23", NAME: "○○○○" }]);
});

test("dual policies inherit original CUSTOM settings, never weaken OMIT and never grant unapproved sources", async () => {
  const { resolveDashboardDisclosureMasks, validDashboardColumnMasks, validSourceColumnMasks } = await import("./dashboardDeviceMasking.js");
  const rules = [
    { columnName: "MRN", sensitivityType: "MRN", deviceMaskMode: "CUSTOM" as const, customMask: { prefix: 1, suffix: 2, symbol: "#" } },
    { columnName: "SECRET", sensitivityType: "HEALTH", deviceMaskMode: "OMIT" as const },
  ];
  const raw = [{ MRN: "SYNTHETIC987654", SECRET: "synthetic-diagnosis", UNAPPROVED: "synthetic-private" }];
  for (const key of ["PRIMARY", "WARD"]) {
    for (const mode of ["INHERIT", "CUSTOM", "FULL", "OMIT"] as const) {
      const approval = { MRN: mode, SECRET: "INHERIT" };
      const config = key === "PRIMARY" ? { deviceColumnMasks: approval } : { deviceSourceColumnMasks: { WARD: approval } };
      const masks = resolveDashboardDisclosureMasks(config, key, rules);
      const rows = maskDeviceRows(raw, masks, rules);
      assert.deepEqual(rows, mode === "OMIT" ? [{}] : [{ MRN: mode === "FULL" ? "○○○○" : "S############54" }]);
      assert.ok(!JSON.stringify(rows).includes("SYNTHETIC987654"));
    }
  }
  assert.deepEqual(resolveDashboardDisclosureMasks({ deviceColumnMasks: { MRN: "INHERIT" } }, "WARD", rules), {});
  assert.equal(resolveDashboardDisclosureMasks({ deviceColumnMasks: { MRN: "INHERIT" } }, "PRIMARY", []).MRN, "OMIT");
  assert.equal(resolveDashboardDisclosureMasks({ deviceColumnMasks: { SECRET: "FULL" } }, "PRIMARY", rules).SECRET, "OMIT");
  assert.equal(validDashboardColumnMasks({ MRN: "INHERIT" }), true);
  assert.equal(validSourceColumnMasks({ WARD: { MRN: "INHERIT" } }), true);
  assert.equal(validSourceColumnMasks({ PRIMARY: { MRN: "INHERIT" } }), false);
  assert.equal(validSourceColumnMasks({ WARD: { MRN: "INHERIT" }, ward: {} }), false);
});
test("ambiguous result aliases cannot borrow a case-insensitive column approval", async () => {
  const { assertDashboardResultColumns } = await import("./dashboardDeviceMasking.js");
  assert.throws(() => assertDashboardResultColumns([{ name: "ROOM" }, { name: "room" }]), /DASHBOARD_COLUMNS_AMBIGUOUS/);
  assert.throws(() => assertDashboardResultColumns([{ name: "ROOM" }, { name: "ROOM" }]), /DASHBOARD_COLUMNS_AMBIGUOUS/);
  assert.doesNotThrow(() => assertDashboardResultColumns([{ name: "ROOM" }, { name: "MRN" }]));
});
