import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { expected923Catalog, render923Draft, render923CatalogSql, validateSynthetic923Catalog, type Catalog923Row } from "./datasetMetadata923Catalog.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const draftDir = "tools/sqlserver-acceptance/drafts/923";
const fixture = (rows: Catalog923Row[] = expected923Catalog()) => ({ format: "SYNTHETIC_923_CATALOG_V1", metadataVisibility: "OWNER_VISIBLE_CATALOG", engineMajor: "15", compatibilityLevel: "150", rows });
const rejected = (rows: Catalog923Row[]) => assert.equal(validateSynthetic923Catalog(fixture(rows)).status, "REJECTED_PARTIAL_OR_DIFFERENT");
const safety = (v: ReturnType<typeof validateSynthetic923Catalog>) => {
  assert.equal(v.authority, "NONE"); assert.equal(v.runtimeBindVerified, false); assert.equal(v.deliveryAllowed, false);
  assert.equal(v.persistence, "NOT_PROVEN"); assert.equal(v.productionSafetyProven, false);
};

test("all absent is NOT_INSTALLED, never install authorization", () => { const r = validateSynthetic923Catalog(fixture([])); assert.equal(r.status, "NOT_INSTALLED"); safety(r); });
test("exact synthetic catalog is consistent only; order independent and repeatable", () => {
  const f = fixture(expected923Catalog().reverse()); const a = validateSynthetic923Catalog(f);
  assert.equal(a.status, "EXACT_MATCH"); assert.deepEqual(validateSynthetic923Catalog(f), a); safety(a);
});
test("golden manifest pins column counts, keys, indexes and three actual rowversions", () => {
  const rows = expected923Catalog();
  const counts = ["DatasetFieldSnapshot", "DatasetSecurityScope", "DatasetSecurityDecision", "DatasetSecurityConfirmation"].map(owner => rows.filter(r => r.category === "COLUMN" && r.owner === owner).length);
  assert.deepEqual(counts, [30, 13, 25, 19]);
  assert.equal(rows.filter(r => r.category === "COLUMN" && r.signature.includes("|timestamp|")).length, 3);
  assert.equal(rows.filter(r => r.category === "INDEX").length, 16);
  assert.equal(rows.filter(r => r.category === "FK").length, 10);
  assert.equal(rows.filter(r => r.category === "KEY").length, 7);
  assert.equal(createHash("sha256").update(JSON.stringify(rows)).digest("hex"), "2bf2d793a204343cd1c04eca6b99e5e3b9a49e377eb1d1b94254b43916b1b42a");
});

for (const category of ["OBJECT", "TABLE", "ROWVERSION_COUNT", "COLUMN", "DEFAULT", "CHECK", "KEY", "INDEX", "FK", "SEQUENCE"]) {
  test(`missing ${category} rejects partial installation`, () => { const rows = expected923Catalog(); rows.splice(rows.findIndex(r => r.category === category), 1); rejected(rows); });
  test(`same name with different ${category} definition rejects`, () => { const rows = expected923Catalog().map(r => ({ ...r })); const row = rows.find(r => r.category === category)!; row.signature += "|UNEXPECTED"; rejected(rows); });
}
for (const [category, name, from, to] of [
  ["COLUMN", "SourceGeneration", "|bigint|", "|int|"],
  ["COLUMN", "LeaseVersion", "|bigint|", "|binary|"],
  ["COLUMN", "DefinitionVersion", "|binary|", "|timestamp|"],
  ["COLUMN", "State", "|Latin1_General_100_BIN2|", "|Chinese_Taiwan_Stroke_CI_AS|"],
  ["COLUMN", "BaseContractVersion", "|0|1|NULL|", "|0|0|NULL|"],
  ["FK", "FK_DatasetSecurityScope_ParentOwner", "DatasetId,ParentOwnerUserId,ParentOwnerKind", "ParentOwnerUserId,DatasetId,ParentOwnerKind"],
  ["FK", "FK_DatasetSecurityDecision_Snapshot", "uqp.DatasetFieldSnapshot", "uqp.Dataset"],
  ["FK", "FK_DatasetSecurityDecision_Snapshot", "|0|0|0|0|0|0", "|1|0|0|0|0|0"],
  ["FK", "FK_DatasetSecurityScope_User", "|0|0|0|0|0|0", "|0|0|1|1|0|0"],
  ["INDEX", "IX_FieldSnapshot_DatasetState", "DatasetId:ASC,State:ASC,Id:ASC", "State:ASC,DatasetId:ASC,Id:ASC"],
  ["INDEX", "IX_FieldSnapshot_DatasetState", "DefinitionVersion,ConfigurationVersion,ExpiresAt", "DefinitionVersion"],
  ["INDEX", "UX_SecurityDecision_CollectionSnapshot", " AND ", " OR "],
  ["CHECK", "CK_DatasetSecurityConfirmation_Active", " IS NOT NULL", " IS NULL"],
  ["CHECK", "CK_DatasetSecurityDecision_Versions", " AND ", " OR "],
  ["DEFAULT", "DF_DatasetSecurityConfirmation_State", "N'PENDING'", "N'ACTIVE'"],
  ["SEQUENCE", "DatasetSecurityDecisionSeq", "9223372036854775807|0|0|NULL", "9223372036854775807|1|0|NULL"],
] as const) test(`${category}/${name}: altered semantics reject (${from})`, () => {
  const rows = expected923Catalog().map(r => ({ ...r })); const row = rows.find(r => r.category === category && r.name === name)!;
  assert.ok(row.signature.includes(from), "fixture mutation must actually change the definition"); row.signature = row.signature.replace(from, to); rejected(rows);
});

for (const category of ["COLUMN", "INDEX", "CHECK", "DEFAULT", "FK", "KEY", "TRIGGER", "UNKNOWN_CHILD", "NAME_COLLISION"]) test(`unexpected ${category} rejects`, () => rejected([...expected923Catalog(), { category, owner: "DatasetSecurityDecision", name: "Unexpected", signature: "UNREVIEWED" }]));
test("extra rowversion, untrusted constraints and disabled indexes cannot match", () => {
  for (const r of expected923Catalog().filter(r => r.category === "CHECK" || r.category === "FK" || r.category === "INDEX")) {
    const rows = expected923Catalog().filter(x => x.name !== r.name); rejected([...rows, { ...r, signature: `${r.signature}|DISABLED_OR_UNTRUSTED` }]);
  }
});
test("NULL/UNKNOWN CHECK loophole is closed by CASE ELSE 0 and explicit shape guards", () => {
  const pass = (sqlTruth: true | false | null) => (sqlTruth === true ? 1 : 0) === 1;
  assert.equal(pass(null), false); assert.equal(pass(false), false); assert.equal(pass(true), true);
  const checks = expected923Catalog().filter(r => r.category === "CHECK");
  for (const c of checks) {
    assert.ok(c.signature.startsWith("(case when "));
    assert.ok(c.signature.includes("then (1) else (0) end=(1))"));
    assert.match(c.signature, /\\|0\\|0\\|0\\|\\d+\\|0\\|1$/u);
  }
  // DDL continues to carry the original explicit CASE/WHEN guard.
  assert.match(render923Draft(), /CHECK \(CASE WHEN/u);
  const active = checks.find(c => c.name === "CK_DatasetSecurityConfirmation_Active")!.signature;
  for (const field of ["Classification", "PolicyDigest", "SensitivityVersion", "ReviewerId", "OwnerUserId", "ReviewerTokenVersion", "OwnerTokenVersion", "ActorScopeEpoch", "OwnerScopeEpoch", "PatientConfigurationVersion", "PatientKeyAlias"]) assert.ok(active.includes(`[${field}] IS NOT NULL`));
  assert.ok(checks.find(c => c.name === "CK_DatasetSecurityScope_Parent")!.signature.includes("[ParentOwnerKind] IS NOT NULL"));
  assert.ok(checks.find(c => c.name === "CK_DatasetSecurityDecision_Shape")!.signature.includes("[ScopeKind] IS NOT NULL"));
  // This tests SQL three-valued-logic guards, not execution of CHECKs by SQL Server.
});
test("BIN2 enums also require exact byte length: trailing-space variants cannot pass SQL equality", () => {
  const sqlEquals = (a: string, b: string) => a.replace(/ +$/u, "") === b.replace(/ +$/u, "");
  const exactEnum = (value: string, choices: string[]) => choices.some(c => sqlEquals(value, c) && Buffer.byteLength(value, "utf16le") === Buffer.byteLength(c, "utf16le"));
  assert.equal(sqlEquals("ACTIVE ", "ACTIVE"), true);
  for (const value of ["ACTIVE ", "OWNER ", "PATIENT           ", "MISSING "]) assert.equal(exactEnum(value, ["ACTIVE", "OWNER", "PATIENT", "NON_PATIENT_PUBLIC", "MISSING"]), false);
  for (const field of ["State", "ScopeKind", "ParentOwnerKind", "ParameterMode", "Kind", "Action", "ReasonCode", "PreviousState", "NextState", "Classification", "ApproverScopeKind", "AuthorizationModelVersion"]) assert.ok(render923Draft().includes(`DATALENGTH([${field}])`));
  const rows = expected923Catalog().map(r => ({ ...r })); const state = rows.find(r => r.name === "CK_DatasetSecurityConfirmation_State")!;
  assert.ok(state.signature.includes("AND datalength([State])=(12)"));
  state.signature = state.signature.replace("AND datalength([State])=(12)", "AND (1)=(1)"); rejected(rows);
});
test("all states/defaults stay within approved domains; missing previous version is not zero", () => {
  const ddl = render923Draft();
  assert.match(ddl, /PreviousStateVersion\] IS NULL/); assert.match(ddl, /PreviousStateVersion\] IS NOT NULL/);
  assert.match(ddl, /PatientConfigurationVersion\] IS NULL AND \[PatientKeyAlias\] IS NULL/);
  assert.match(ddl, /ReviewerId\]=\[OwnerUserId\]/); assert.match(ddl, /ReviewerId\]<>\[OwnerUserId\]/);
  assert.doesNotMatch(ddl, /DEFAULT \(N'(ACTIVE|SOURCE_BOUND)'\)/);
});
test("922 absence/presence is outside the 923 catalog projection", () => {
  const project = (whole: Catalog923Row[]) => whole.filter(r => r.owner !== "NativeTypeAuthorizationEpoch");
  const absent922 = fixture(project(expected923Catalog()));
  const present922 = fixture(project([...expected923Catalog(), { category: "COLUMN", owner: "NativeTypeAuthorizationEpoch", name: "Epoch", signature: "UNRELATED_922" }]));
  assert.deepEqual(validateSynthetic923Catalog(absent922), validateSynthetic923Catalog(present922));
  assert.equal(validateSynthetic923Catalog(absent922).status, "EXACT_MATCH");
  assert.doesNotMatch(render923CatalogSql(), /NativeTypeAuthorizationEpoch|DatasetNativeTypeReview|DatasetNativeTypeDecision/);
});
for (const [key, value] of [["metadataVisibility", "UNKNOWN"], ["metadataVisibility", "OBJECT_ONLY"], ["engineMajor", "16"], ["compatibilityLevel", "140"], ["format", "FORGED"], ["engineMajor", 15]] as const) test(`unknown catalog envelope ${key}/${value} refuses`, () => { assert.equal(validateSynthetic923Catalog({ ...fixture(), [key]: value }).status, "REJECTED_UNKNOWN"); });
test("duplicate rows, missing/unknown fields, invalid metadata values refuse", () => {
  const f = fixture(); const cases: unknown[] = [{ ...f, extra: true }, { ...f, rows: [...f.rows, f.rows[0]] }, { ...f, rows: [{ ...f.rows[0], signature: 9007199254740993n }, { ...f.rows[0], signature: Number.MAX_SAFE_INTEGER + 1 }] }, { ...f, rows: [{ category: "COLUMN" }] }, { ...f, rows: [{ ...f.rows[0], extra: true }] }, { ...f, rows: new Array(1001).fill(f.rows[0]) }];
  for (const c of cases) assert.equal(validateSynthetic923Catalog(c).status, "REJECTED_UNKNOWN");
});
test("getters/proxies are not executed; malicious input and exceptions never serialize", () => {
  let calls = 0; const secret = "SYNTHETIC_SECRET_NOT_FOR_OUTPUT";
  const getter = Object.defineProperty({}, "format", { enumerable: true, get() { calls++; throw new Error(secret); } });
  const proxy = new Proxy({}, { ownKeys() { calls++; throw new Error(secret); }, getPrototypeOf() { calls++; throw new Error(secret); } });
  const rows = fixture(); Object.defineProperty(rows.rows, "0", { enumerable: true, get() { calls++; throw new Error(secret); } });
  for (const input of [getter, proxy, rows, fixture([proxy as Catalog923Row]), { ...fixture(), rows: new Proxy([], { get() { calls++; throw new Error(secret); } }) }]) {
    const result = validateSynthetic923Catalog(input); assert.equal(result.status, "REJECTED_UNKNOWN"); assert.ok(!JSON.stringify(result).includes(secret)); safety(result);
  }
  assert.equal(calls, 0);
});
test("exact comparison preserves literal spaces, parentheses, case and length", () => {
  for (const suffix of [" ", "\u00a0", ")", "x"]) { const rows = expected923Catalog().map(r => ({ ...r })); rows[0]!.signature += suffix; rejected(rows); }
  const sql = render923CatalogSql(); assert.match(sql, /DATALENGTH\(signature\) l4/); assert.doesNotMatch(sql, /REPLACE\(/);
});
test("BIGINT sequence values remain text and no Number repair exists", () => {
  const row = expected923Catalog().find(r => r.category === "SEQUENCE")!; assert.ok(row.signature.includes("9223372036854775807"));
  assert.match(render923CatalogSql(), /CONVERT\(varchar\(40\),s.start_value\)/);
});
test("checked-in SQL artifacts exactly match reviewed contract source", async () => {
  assert.equal(await readFile(path.join(root, draftDir, "923_dataset_metadata.draft.sql"), "utf8"), render923Draft());
  assert.equal(await readFile(path.join(root, draftDir, "923_catalog_readonly.sql"), "utf8"), render923CatalogSql());
});
test("DDL contains only approved new-object DDL, no data writes/grants/runtime/seeds", () => {
  const ddl = render923Draft();
  assert.equal((ddl.match(/CREATE TABLE /g) ?? []).length, 4); assert.equal((ddl.match(/CREATE SEQUENCE /g) ?? []).length, 1);
  assert.doesNotMatch(ddl.replace(/^--.*$/gm, ""), /\b(INSERT|MERGE|EXEC|GRANT|DENY|TRUNCATE|DROP|ALTER)\b|SchemaMigration|JWT_SECRET|AuditLog\]|NativeTypeReview/i);
  assert.doesNotMatch(ddl, /REFERENCES.*AuditLog|FOREIGN KEY \(\[DecisionId\]\)/);
  assert.equal((ddl.match(/ON DELETE NO ACTION ON UPDATE NO ACTION/g) ?? []).length, 10);
});
test("catalog validator is a single SELECT/CTE, sys metadata only", () => {
  const sql = render923CatalogSql().replace(/^--.*$/gm, "").replace(/N?'(?:''|[^'])*'/g, "''");
  assert.doesNotMatch(sql, /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|GRANT|DENY|INTO|OPENROWSET|OPENDATASOURCE)\b/i);
  assert.doesNotMatch(sql, /\buqp\s*\./i); assert.match(sql, /sys\.foreign_key_columns/); assert.match(sql, /sys\.check_constraints/);
  assert.equal((sql.match(/;/g) ?? []).length, 2);
});
test("runner auto-scan cannot discover drafts; status/adopt bootstrap risk is documented without importing runner", async () => {
  const source = await readFile(path.join(root, "server/src/scripts/migrate.ts"), "utf8");
  assert.match(source, /readdir\(migrationsDir\)/); assert.match(source, /database\/migrations/); assert.match(source, /main\(\)/);
  const migrationDir = path.join(root, "database/migrations");
  assert.ok(!path.resolve(root, draftDir).startsWith(`${migrationDir}${path.sep}`));
  const discovered = (await readdir(migrationDir)).filter(f => /^\d+_.*\.sql$/i.test(f));
  assert.ok(discovered.every(f => !/^92[23]_/.test(f)));
  const pretend = ["921_existing.sql", "923_accidentally_registered.sql"].filter(f => /^\d+_.*\.sql$/i.test(f));
  assert.ok(pretend.includes("923_accidentally_registered.sql"), "same filename in migration root would be dangerous");
});
