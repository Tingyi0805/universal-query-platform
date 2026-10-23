import { types } from "node:util";
import { sqlServer2019CheckGolden } from "./datasetMetadata923CheckGolden.js";

/** Offline source contract only. No connection, SQL execution, issuer or application integration. */
const schema = "uqp";
const bin2 = "Latin1_General_100_BIN2";
const sequenceName = "DatasetSecurityDecisionSeq";
type Column = { name: string; type: string; nullable: boolean; identity?: true; default?: string };
type ForeignKey = { name: string; columns: string[]; target: string; references: string[] };
type Index = { name: string; columns: string[]; include: string[]; unique: boolean; kind: "PK" | "UQ" | "IX"; filter: string | null };
type Table = { name: string; columns: Column[]; checks: { name: string; predicate: string }[]; foreignKeys: ForeignKey[]; indexes: Index[] };
export type Catalog923Row = Readonly<{ category: string; owner: string; name: string; signature: string }>;
const q = (s: string) => `[${s}]`;
const literal = (s: string) => `N'${s.replaceAll("'", "''")}'`;
const idList = (s: string[]) => s.map(q).join(",");
const column = (name: string, type: string, nullable = false, extra: Partial<Column> = {}): Column => ({ name, type, nullable, ...extra });
const ids = (...names: string[]) => names.map(n => column(n, "BIGINT"));
const texts = (length: number | "MAX", ...names: string[]) => names.map(n => column(n, `NVARCHAR(${length})`));
const bytes = (length: number, ...names: string[]) => names.map(n => column(n, `BINARY(${length})`));
const uuid = (...names: string[]) => names.map(n => column(n, "UNIQUEIDENTIFIER"));
const times = (...names: string[]) => names.map(n => column(n, "DATETIME2(7)"));
// SQL equality pads trailing spaces even under BIN2. Pair each value with its exact UTF-16 byte length.
const enumeration = (field: string, values: string[]) => `(${values.map(v => `(${q(field)}=${literal(v)} AND DATALENGTH(${q(field)})=(${Buffer.byteLength(v, "utf16le")}))`).join(" OR ")})`;
const optional = (field: string, predicate: string) => `(${q(field)} IS NULL OR (${predicate}))`;
const present = (fields: string[]) => fields.map(n => `${q(n)} IS NOT NULL`).join(" AND ");
const positive = (fields: string[]) => fields.map(n => optional(n, `${q(n)}>(0)`)).join(" AND ");
const nonzero = (fields: string[]) => fields.map(n => optional(n, `${q(n)}<>0x0000000000000000`)).join(" AND ");
const index = (name: string, columns: string[], include: string[] = [], unique = false, kind: Index["kind"] = "IX", filter: string | null = null): Index => ({ name, columns, include, unique, kind, filter });
const table = (name: string, columns: Column[], pk: string[]): Table => ({ name, columns, checks: [], foreignKeys: [], indexes: [index(`PK_${name}`, pk, [], true, "PK")] });
const check = (t: Table, suffix: string, predicate: string) => t.checks.push({ name: `CK_${t.name}_${suffix}`, predicate });
const strengthen = (t: Table, suffix: string, predicate: string) => {
  const c = t.checks.find(c => c.name === `CK_${t.name}_${suffix}`)!;
  c.predicate = `(${c.predicate}) AND (${predicate})`;
};
const fk = (t: Table, suffix: string, columns: string[], target: string, references: string[] = ["Id"]) => t.foreignKeys.push({ name: `FK_${t.name}_${suffix}`, columns, target, references });
const json = (field: string, max: string, nullable = false) => {
  const p = `ISJSON(${q(field)})=(1) AND DATALENGTH(${q(field)})<=(${max})`;
  return nullable ? optional(field, p) : p;
};
const snapshotStates = ["DESCRIBED", "SOURCE_BOUND", "INVALIDATED", "EXPIRED"];
const confirmationStates = ["PENDING", "ACTIVE", "REJECTED", "REVOKED", "INVALIDATED"];
const scopeStates = ["ACTIVE", "REVOKED"];
const classifications = ["NON_PATIENT_PUBLIC", "NON_PATIENT_SENSITIVE", "PATIENT"];

function contract(): Table[] {
  const snapshot = table("DatasetFieldSnapshot", [
    column("Id", "BIGINT", false, { identity: true }), ...ids("DatasetId", "DataSourceId"), ...uuid("PlatformIncarnation"),
    ...bytes(8, "DefinitionVersion", "ConfigurationVersion"), column("BaseContractVersion", "BINARY(8)", true),
    ...bytes(32, "SqlDigest", "ParameterDigest", "NativeTypesDigest", "ColumnsDigest"), ...texts("MAX", "ColumnsJson", "NativeBindingsJson"),
    ...texts(16, "ParameterMode"), ...texts(64, "CollectorVersion", "CodecVersion", "PlanVersion", "DriverVersion"),
    ...times("CollectedAt", "ExpiresAt"), column("State", "NVARCHAR(16)", false, { default: "N'DESCRIBED'" }), column("StateRowVersion", "ROWVERSION"),
    ...["SourceIdentity", "SourceIncarnation", "LeaseId"].map(n => column(n, "UNIQUEIDENTIFIER", true)),
    ...["SourceGeneration", "LeaseVersion"].map(n => column(n, "BIGINT", true)), column("SourceCollation", "NVARCHAR(128)", true),
    column("CollectorEvidenceDigest", "BINARY(32)", true), column("SourceEvidenceJson", "NVARCHAR(MAX)", true),
  ], ["Id"]);
  snapshot.indexes.push(index("UQ_DatasetFieldSnapshot_DatasetId_Id", ["DatasetId", "Id"], [], true, "UQ"),
    index("IX_FieldSnapshot_DatasetState", ["DatasetId", "State", "Id"], ["DefinitionVersion", "ConfigurationVersion", "ExpiresAt"]),
    index("IX_FieldSnapshot_Source", ["DataSourceId", "DatasetId", "Id"]));
  fk(snapshot, "Dataset", ["DatasetId"], "Dataset"); fk(snapshot, "DataSource", ["DataSourceId"], "DataSource");
  check(snapshot, "Ids", positive(["Id", "DatasetId", "DataSourceId", "SourceGeneration", "LeaseVersion"]));
  check(snapshot, "Versions", nonzero(["DefinitionVersion", "ConfigurationVersion", "BaseContractVersion"]));
  check(snapshot, "State", enumeration("State", snapshotStates));
  check(snapshot, "ParameterMode", enumeration("ParameterMode", ["NO_PARAMETERS", "UNPROVEN"]));
  check(snapshot, "Expiry", "[ExpiresAt]>[CollectedAt]");
  check(snapshot, "Json", `${json("ColumnsJson", "1048576")} AND ${json("NativeBindingsJson", "1048576")} AND ${json("SourceEvidenceJson", "65536", true)}`);
  check(snapshot, "SourceBound", `[State]<>N'SOURCE_BOUND' OR ([ParameterMode]=N'NO_PARAMETERS' AND ${present(["SourceIdentity", "SourceIncarnation", "LeaseId", "SourceGeneration", "LeaseVersion", "SourceCollation", "CollectorEvidenceDigest", "SourceEvidenceJson"])})`);

  const scope = table("DatasetSecurityScope", [
    ...ids("DatasetId", "UserId"), ...texts(8, "ScopeKind"), ...ids("BoundDataSourceId"), column("State", "NVARCHAR(8)", false, { default: "N'REVOKED'" }),
    column("ParentOwnerUserId", "BIGINT", true), column("ParentOwnerKind", "NVARCHAR(8)", true), ...ids("ChangedByUserId"),
    ...uuid("LastRequestId"), ...texts(32, "LastReasonCode"), ...times("GrantedAt", "ChangedAt"), column("ScopeRowVersion", "ROWVERSION"),
  ], ["DatasetId", "UserId", "ScopeKind"]);
  scope.indexes.push(index("UQ_DatasetSecurityScope_LastRequestId", ["LastRequestId"], [], true, "UQ"),
    index("IX_SecurityScope_User", ["UserId", "State", "DatasetId", "ScopeKind"], ["BoundDataSourceId", "ParentOwnerUserId"]),
    index("IX_SecurityScope_Parent", ["DatasetId", "ParentOwnerUserId", "ParentOwnerKind", "State", "UserId"]),
    index("IX_SecurityScope_Source", ["BoundDataSourceId", "DatasetId", "UserId", "ScopeKind"]));
  fk(scope, "Dataset", ["DatasetId"], "Dataset"); fk(scope, "User", ["UserId"], "AppUser"); fk(scope, "DataSource", ["BoundDataSourceId"], "DataSource");
  fk(scope, "ParentOwner", ["DatasetId", "ParentOwnerUserId", "ParentOwnerKind"], scope.name, ["DatasetId", "UserId", "ScopeKind"]);
  check(scope, "Ids", positive(["DatasetId", "UserId", "BoundDataSourceId", "ChangedByUserId", "ParentOwnerUserId"]));
  check(scope, "State", enumeration("State", scopeStates));
  check(scope, "Parent", "([ScopeKind]=N'OWNER' AND [ParentOwnerUserId] IS NULL AND [ParentOwnerKind] IS NULL) OR ([ScopeKind]=N'REVIEWER' AND [ParentOwnerUserId] IS NOT NULL AND [ParentOwnerKind] IS NOT NULL AND [ParentOwnerKind]=N'OWNER' AND [UserId]<>[ParentOwnerUserId])");

  const decision = table("DatasetSecurityDecision", [
    column("Id", "BIGINT", false, { default: `NEXT VALUE FOR [uqp].[${sequenceName}]` }), ...ids("DatasetId"), ...texts(16, "Kind"),
    column("SnapshotId", "BIGINT", true), column("SubjectUserId", "BIGINT", true), column("ScopeKind", "NVARCHAR(8)", true),
    ...uuid("RequestId"), ...bytes(32, "CommandDigest"), ...ids("ActorId", "ActorTokenVersion"), ...texts(32, "Action", "ReasonCode"),
    ...texts(16, "PreviousState", "NextState"), column("PreviousStateVersion", "BINARY(8)", true), ...bytes(8, "NextStateVersion"),
    ...["SnapshotDigest", "PolicyDigest", "SourceOperationEvidenceDigest"].map(n => column(n, "BINARY(32)", true)),
    ...texts("MAX", "AuthorizationEvidenceJson", "DetailsJson"), ...ids("AuditLogId"), ...uuid("TransactionReference", "PlatformIncarnation"), ...times("DecidedAt"),
  ], ["Id"]);
  decision.indexes.push(index("UQ_DatasetSecurityDecision_RequestId", ["RequestId"], [], true, "UQ"),
    index("IX_SecurityDecision_Dataset", ["DatasetId", "Id"]), index("IX_SecurityDecision_Snapshot", ["SnapshotId", "Id"]),
    index("UX_SecurityDecision_CollectionSnapshot", ["SnapshotId"], [], true, "IX", "([Kind]=N'SNAPSHOT' AND [Action]=N'COLLECT_METADATA')"));
  fk(decision, "Dataset", ["DatasetId"], "Dataset"); fk(decision, "Snapshot", ["DatasetId", "SnapshotId"], snapshot.name, ["DatasetId", "Id"]);
  fk(decision, "Scope", ["DatasetId", "SubjectUserId", "ScopeKind"], scope.name, ["DatasetId", "UserId", "ScopeKind"]);
  check(decision, "Ids", positive(["Id", "DatasetId", "SnapshotId", "SubjectUserId", "ActorId", "ActorTokenVersion", "AuditLogId"]));
  check(decision, "Shape", "([Kind]=N'SCOPE' AND [SubjectUserId] IS NOT NULL AND [ScopeKind] IS NOT NULL AND [ScopeKind] IN (N'OWNER',N'REVIEWER') AND [SnapshotId] IS NULL) OR ([Kind] IN (N'SNAPSHOT',N'CONFIRMATION') AND [SubjectUserId] IS NULL AND [ScopeKind] IS NULL AND [SnapshotId] IS NOT NULL)");
  check(decision, "Action", "([Kind]=N'SNAPSHOT' AND [Action] IN (N'COLLECT_METADATA',N'INVALIDATE')) OR ([Kind]=N'SCOPE' AND [Action] IN (N'GRANT_SCOPE',N'REVOKE_SCOPE')) OR ([Kind]=N'CONFIRMATION' AND [Action] IN (N'CONFIRM',N'REJECT',N'REVOKE',N'INVALIDATE'))");
  check(decision, "Reason", enumeration("ReasonCode", ["METADATA_COLLECTED", "OWNER_APPOINTED", "REVIEWER_APPOINTED", "SCOPE_REBOUND", "SCOPE_REVOKED", "CLASSIFICATION_ACCEPTED", "POLICY_REJECTED", "AUTHORIZATION_REVOKED", "EVIDENCE_CHANGED"]));
  check(decision, "States", [["SNAPSHOT", snapshotStates], ["SCOPE", scopeStates], ["CONFIRMATION", confirmationStates]].map(([kind, states]) => `([Kind]=${literal(kind as string)} AND ${enumeration("PreviousState", ["MISSING", ...states as string[]])} AND ${enumeration("NextState", states as string[])})`).join(" OR "));
  check(decision, "Versions", `(([PreviousState]=N'MISSING' AND [PreviousStateVersion] IS NULL) OR ([PreviousState]<>N'MISSING' AND [PreviousStateVersion] IS NOT NULL)) AND ${nonzero(["PreviousStateVersion", "NextStateVersion"])}`);
  check(decision, "Json", `${json("AuthorizationEvidenceJson", "16384")} AND ${json("DetailsJson", "16384")}`);

  const confirmation = table("DatasetSecurityConfirmation", [
    ...ids("DatasetId", "SnapshotId"), column("State", "NVARCHAR(16)", false, { default: "N'PENDING'" }), column("StateRowVersion", "ROWVERSION"), ...ids("DecisionId"),
    column("Classification", "NVARCHAR(24)", true), column("SensitivityVersion", "BIGINT", true), column("PolicyDigest", "BINARY(32)", true),
    column("PatientConfigurationVersion", "BIGINT", true), column("PatientKeyAlias", "NVARCHAR(128)", true),
    ...["ReviewerId", "OwnerUserId"].map(n => column(n, "BIGINT", true)), column("ApproverScopeKind", "NVARCHAR(8)", true),
    ...["ReviewerTokenVersion", "OwnerTokenVersion"].map(n => column(n, "BIGINT", true)),
    ...["ActorScopeEpoch", "OwnerScopeEpoch"].map(n => column(n, "BINARY(8)", true)), ...texts(32, "AuthorizationModelVersion"), ...uuid("PlatformIncarnation"),
  ], ["DatasetId"]);
  confirmation.indexes.push(index("IX_SecurityConfirmation_Snapshot", ["SnapshotId", "DatasetId"]));
  fk(confirmation, "Snapshot", ["DatasetId", "SnapshotId"], snapshot.name, ["DatasetId", "Id"]);
  check(confirmation, "Ids", positive(["DatasetId", "SnapshotId", "DecisionId", "SensitivityVersion", "PatientConfigurationVersion", "ReviewerId", "OwnerUserId", "ReviewerTokenVersion", "OwnerTokenVersion"]));
  check(confirmation, "Epochs", nonzero(["ActorScopeEpoch", "OwnerScopeEpoch"]));
  check(confirmation, "State", enumeration("State", confirmationStates));
  check(confirmation, "Classification", optional("Classification", enumeration("Classification", classifications)));
  check(confirmation, "ScopeKind", optional("ApproverScopeKind", enumeration("ApproverScopeKind", ["OWNER", "REVIEWER"])));
  check(confirmation, "AuthorizationModel", enumeration("AuthorizationModelVersion", ["DATASET_SCOPE_AUTH_V1"]));
  check(confirmation, "Active", `[State]<>N'ACTIVE' OR (${present(["Classification", "SensitivityVersion", "PolicyDigest", "ReviewerId", "OwnerUserId", "ApproverScopeKind", "ReviewerTokenVersion", "OwnerTokenVersion", "ActorScopeEpoch", "OwnerScopeEpoch"])} AND (([ApproverScopeKind]=N'OWNER' AND [ReviewerId]=[OwnerUserId] AND [ReviewerTokenVersion]=[OwnerTokenVersion] AND [ActorScopeEpoch]=[OwnerScopeEpoch]) OR ([ApproverScopeKind]=N'REVIEWER' AND [ReviewerId]<>[OwnerUserId])) AND (([Classification]=N'PATIENT' AND [PatientConfigurationVersion] IS NOT NULL AND [PatientKeyAlias] IS NOT NULL AND DATALENGTH([PatientKeyAlias])>(0)) OR ([Classification] IN (N'NON_PATIENT_PUBLIC',N'NON_PATIENT_SENSITIVE') AND [PatientConfigurationVersion] IS NULL AND [PatientKeyAlias] IS NULL)))`);
  strengthen(scope, "Parent", `${enumeration("ScopeKind", ["OWNER", "REVIEWER"])} AND ${optional("ParentOwnerKind", enumeration("ParentOwnerKind", ["OWNER"]))}`);
  strengthen(decision, "Shape", `${enumeration("Kind", ["SNAPSHOT", "SCOPE", "CONFIRMATION"])} AND ${optional("ScopeKind", enumeration("ScopeKind", ["OWNER", "REVIEWER"]))}`);
  strengthen(decision, "Action", enumeration("Action", ["COLLECT_METADATA", "GRANT_SCOPE", "REVOKE_SCOPE", "CONFIRM", "REJECT", "REVOKE", "INVALIDATE"]));
  return [snapshot, scope, decision, confirmation];
}

// CASE rejects SQL UNKNOWN as well as FALSE, including nullable composite-FK shapes.
const checkDefinition = (predicate: string) => `(CASE WHEN (${predicate}) THEN (1) ELSE (0) END=(1))`;
const defaultName = (t: Table, c: Column) => `DF_${t.name}_${c.name}`;
const columnDDL = (t: Table, c: Column) => `${q(c.name)} ${c.type}${c.type.startsWith("NVARCHAR") ? ` COLLATE ${bin2}` : ""}${c.identity ? " IDENTITY(1,1)" : ""} ${c.nullable ? "NULL" : "NOT NULL"}${c.default ? ` CONSTRAINT ${q(defaultName(t, c))} DEFAULT (${c.default})` : ""}`;

export function render923Draft(): string {
  const chunks = ["-- OFFLINE DRAFT ONLY: not an installed/registered Migration. No authority or delivery grants.",
    "-- Requires separately approved owned transaction + XACT_ABORT, exact preflight, backup and permissions review.",
    "-- Append-only is NOT established: future app principal must lack direct DML/ALTER and sequence-restart rights; only reviewed modules may write.",
    "-- No role, permission seed, grant, scope assignment or trusted issuer is installed by this draft.",
    "-- Do not run through db:migrate. Partial/existing schemas must be rejected by the validator; no repair/adopt.",
    `CREATE SEQUENCE [uqp].[${sequenceName}] AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 NO CYCLE NO CACHE;`];
  for (const t of contract()) {
    const definitions = t.columns.map(c => columnDDL(t, c));
    for (const i of t.indexes.filter(i => i.kind !== "IX")) definitions.push(`CONSTRAINT ${q(i.name)} ${i.kind === "PK" ? "PRIMARY KEY CLUSTERED" : "UNIQUE NONCLUSTERED"} (${i.columns.map(n => `${q(n)} ASC`).join(",")})`);
    for (const c of t.checks) definitions.push(`CONSTRAINT ${q(c.name)} CHECK ${checkDefinition(c.predicate)}`);
    for (const f of t.foreignKeys) definitions.push(`CONSTRAINT ${q(f.name)} FOREIGN KEY (${idList(f.columns)}) REFERENCES [uqp].${q(f.target)} (${idList(f.references)}) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    chunks.push(`CREATE TABLE [uqp].${q(t.name)} (\n  ${definitions.join(",\n  ")}\n);`);
    for (const i of t.indexes.filter(i => i.kind === "IX")) chunks.push(`CREATE ${i.unique ? "UNIQUE " : ""}NONCLUSTERED INDEX ${q(i.name)} ON [uqp].${q(t.name)} (${i.columns.map(n => `${q(n)} ASC`).join(",")})${i.include.length ? ` INCLUDE (${idList(i.include)})` : ""}${i.filter ? ` WHERE ${i.filter}` : ""};`);
  }
  return `${chunks.join("\n\n")}\n`;
}

// Exact signatures. Never strip expression parentheses, literal whitespace or Unicode.
export function expected923Catalog(): Catalog923Row[] {
  const rows: Catalog923Row[] = [];
  const add = (category: string, owner: string, name: string, signature: string) => rows.push({ category, owner, name, signature });
  add("OBJECT", schema, sequenceName, "SO|0");
  add("SEQUENCE", schema, sequenceName, "bigint|8|19|0|1|1|1|9223372036854775807|0|0|NULL|0");
  for (const t of contract()) {
    add("OBJECT", schema, t.name, "U|0");
    add("TABLE", t.name, t.name, "0|0|0|0|0|0");
    add("ROWVERSION_COUNT", t.name, t.name, String(t.columns.filter(c => c.type === "ROWVERSION").length));
    // uses_ansi_nulls must be ON (the final flag is inverted in the SQL projection).
    for (const [n, c] of t.columns.entries()) {
      const text = /^NVARCHAR\((MAX|\d+)\)$/.exec(c.type);
      const binary = /^BINARY\((\d+)\)$/.exec(c.type);
      const type = text ? "nvarchar" : binary ? "binary" : c.type === "ROWVERSION" ? "timestamp" : c.type.split("(")[0]!.toLowerCase();
      const length = text ? text[1] === "MAX" ? "-1" : String(BigInt(text[1]!) * 2n) : binary ? binary[1]! : c.type === "BIGINT" || c.type === "ROWVERSION" || c.type === "DATETIME2(7)" ? "8" : "16";
      const precision = c.type === "BIGINT" ? "19" : c.type === "DATETIME2(7)" ? "27" : "0";
      const scale = c.type === "DATETIME2(7)" ? "7" : "0";
      add("COLUMN", t.name, c.name, [n + 1, type, length, precision, scale, c.nullable ? "1" : "0", text ? bin2 : "NULL", c.identity ? "1|1|1|0" : "0|NULL|NULL|0", "0|0|0|0|0|0|0"].join("|"));
      if (c.default) add("DEFAULT", t.name, defaultName(t, c), `${c.name}|(${c.default})|0`);
    }
    for (const i of t.indexes) {
      add("INDEX", t.name, i.name, [i.kind === "PK" ? "1" : "2", i.unique ? "1" : "0", "0|0|0", i.kind === "PK" ? "1" : "0", i.kind === "UQ" ? "1" : "0", i.columns.map(n => `${n}:ASC`).join(","), i.include.join(","), i.filter ?? "NULL", "0|1|1|0"].join("|"));
      if (i.kind !== "IX") add("KEY", t.name, i.name, `${i.kind}|${i.name}|0`);
    }
    for (const c of t.checks) {
      // SQL Server 2019 persists CHECK expressions in a rewritten, lowercase
      // canonical form and assigns a real parent_column_id/uses_database_collation.
      // Pin the exact observed SQL2019 catalog bytes; never normalize target
      // expressions during validation, or silently accept unknown serializers.
      const persisted = sqlServer2019CheckGolden[`${t.name}.${c.name}`];
      if (typeof persisted !== "string") throw new Error("923_SQL2019_CHECK_GOLDEN_MISSING");
      add("CHECK", t.name, c.name, persisted);
    }
    for (const f of t.foreignKeys) add("FK", t.name, f.name, `${f.columns.join(",")}|uqp.${f.target}|${f.references.join(",")}|0|0|0|0|0|0`);
  }
  return rows;
}

const protection = Object.freeze({ authority: "NONE", runtimeBindVerified: false, deliveryAllowed: false, persistence: "NOT_PROVEN", productionSafetyProven: false } as const);
type CatalogResult = "NOT_INSTALLED" | "EXACT_MATCH" | "REJECTED_PARTIAL_OR_DIFFERENT" | "REJECTED_UNKNOWN";
function record(v: unknown, keys: string[]): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || types.isProxy(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return null;
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !d.enumerable || !("value" in d)) return null;
    result[k] = d.value;
  }
  return result;
}

/** SYNTHETIC_TEST_ONLY input; a matching snapshot never proves actual catalog visibility/persistence. */
export function validateSynthetic923Catalog(input: unknown) {
  const answer = (status: CatalogResult) => Object.freeze({ status, ...protection });
  try {
    const envelope = record(input, ["format", "metadataVisibility", "engineMajor", "compatibilityLevel", "rows"]);
    if (!envelope || envelope.format !== "SYNTHETIC_923_CATALOG_V1" || envelope.metadataVisibility !== "OWNER_VISIBLE_CATALOG"
      || envelope.engineMajor !== "15" || envelope.compatibilityLevel !== "150") return answer("REJECTED_UNKNOWN");
    const data = envelope.rows;
    if (!Array.isArray(data) || types.isProxy(data) || Object.getPrototypeOf(data) !== Array.prototype || data.length > 1000
      || Reflect.ownKeys(data).length !== data.length + 1) return answer("REJECTED_UNKNOWN");
    const actual: Catalog923Row[] = [];
    for (let n = 0; n < data.length; n++) {
      const d = Object.getOwnPropertyDescriptor(data, String(n));
      const row = d && "value" in d && record(d.value, ["category", "owner", "name", "signature"]);
      if (!row || Object.values(row).some(x => typeof x !== "string" || x.length > 16000 || /[\u0000-\u001f]/u.test(x))) return answer("REJECTED_UNKNOWN");
      actual.push(row as Catalog923Row);
    }
    // Only manifest-scoped rows are permitted: a 922 observation belongs in a separate result set.
    const encode = (r: Catalog923Row) => JSON.stringify([r.category, r.owner, r.name, r.signature]);
    const a = actual.map(encode).sort(); const e = expected923Catalog().map(encode).sort();
    if (new Set(a).size !== a.length) return answer("REJECTED_UNKNOWN");
    if (a.length === 0) return answer("NOT_INSTALLED");
    return answer(a.length === e.length && a.every((x, i) => x === e[i]) ? "EXACT_MATCH" : "REJECTED_PARTIAL_OR_DIFFERENT");
  } catch { return answer("REJECTED_UNKNOWN"); }
}

/** Emits a single SELECT/CTE statement over sys catalog only; never executes it. */
export function render923CatalogSql(): string {
  const expected = expected923Catalog();
  const values = expected.map(r => `(${[r.category, r.owner, r.name, r.signature].map(literal).join(",")})`).join(",\n    ");
  const names = contract().map(t => literal(t.name)).join(",");
  const constraintOwners = contract().flatMap(t => [
    ...t.checks.map(c => [c.name, t.name]), ...t.foreignKeys.map(f => [f.name, t.name]),
    ...t.indexes.filter(i => i.kind !== "IX").map(i => [i.name, t.name]),
    ...t.columns.filter(c => c.default).map(c => [defaultName(t, c), t.name]),
  ]).map(pair => `(${pair.map(literal).join(",")})`).join(",\n    ");
  return `-- OFFLINE SOURCE ONLY. Do not execute without separate isolated-environment authorization.
-- Exact expression text is intentional: unobserved SQL Server serialization is rejected, never normalized away.
-- No business rows, SchemaMigration, permissions writes, dynamic SQL or 922 dependency.
;WITH Expected(category,owner,name,signature) AS (
  SELECT CONVERT(nvarchar(32),v.category) COLLATE ${bin2}, CONVERT(nvarchar(128),v.owner) COLLATE ${bin2},
         CONVERT(nvarchar(128),v.name) COLLATE ${bin2}, CONVERT(nvarchar(max),v.signature) COLLATE ${bin2}
  FROM (VALUES
    ${values}
  ) v(category,owner,name,signature)
), ConstraintOwners(name,table_name) AS (SELECT v.name,v.table_name FROM (VALUES
    ${constraintOwners}
  ) v(name,table_name)), Targets AS (
  SELECT o.* FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
  WHERE s.name=N'uqp' AND o.name IN (${names},N'${sequenceName}')
), Tables AS (SELECT t.* FROM sys.tables t JOIN Targets o ON o.object_id=t.object_id),
ActualRaw(category,owner,name,signature) AS (
  SELECT N'OBJECT',OBJECT_SCHEMA_NAME(o.object_id),o.name,CONVERT(nvarchar(max),CONCAT(RTRIM(o.type),N'|',o.is_ms_shipped)) FROM Targets o
  UNION ALL
  SELECT N'TABLE',t.name,t.name,CONCAT(t.temporal_type,N'|',t.is_memory_optimized,N'|',t.is_filetable,N'|',t.is_tracked_by_cdc,N'|',t.is_replicated,N'|',1-t.uses_ansi_nulls) FROM Tables t
  UNION ALL
  SELECT N'COLUMN',t.name,c.name,CONCAT(c.column_id,N'|',ty.name,N'|',c.max_length,N'|',c.precision,N'|',c.scale,N'|',c.is_nullable,N'|',COALESCE(c.collation_name,N'NULL'),N'|',c.is_identity,N'|',COALESCE(CONVERT(varchar(40),ic.seed_value),N'NULL'),N'|',COALESCE(CONVERT(varchar(40),ic.increment_value),N'NULL'),N'|',COALESCE(ic.is_not_for_replication,0),N'|',c.is_computed,N'|',c.is_rowguidcol,N'|',c.is_sparse,N'|',c.is_column_set,N'|',c.generated_always_type,N'|',c.is_hidden,N'|',CASE WHEN c.user_type_id=c.system_type_id AND c.encryption_type IS NULL AND COALESCE(mc.is_masked,0)=0 AND c.rule_object_id=0 AND (c.default_object_id=0 OR EXISTS (SELECT 1 FROM sys.default_constraints dc WHERE dc.object_id=c.default_object_id)) THEN 0 ELSE 1 END)
  FROM Tables t JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
  LEFT JOIN sys.masked_columns mc ON mc.object_id=c.object_id AND mc.column_id=c.column_id
  LEFT JOIN sys.identity_columns ic ON ic.object_id=c.object_id AND ic.column_id=c.column_id
  UNION ALL
  SELECT N'ROWVERSION_COUNT',t.name,t.name,CONVERT(nvarchar(max),(SELECT COUNT_BIG(*) FROM sys.columns c WHERE c.object_id=t.object_id AND c.system_type_id=189)) FROM Tables t
  UNION ALL
  SELECT N'DEFAULT',t.name,d.name,CONCAT(c.name,N'|',d.definition,N'|',d.is_system_named) FROM Tables t JOIN sys.default_constraints d ON d.parent_object_id=t.object_id JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=d.parent_column_id
  UNION ALL
  SELECT N'CHECK',t.name,c.name,CONCAT(c.definition,N'|',c.is_disabled,N'|',c.is_not_trusted,N'|',c.is_not_for_replication,N'|',c.parent_column_id,N'|',c.is_system_named,N'|',c.uses_database_collation) FROM Tables t JOIN sys.check_constraints c ON c.parent_object_id=t.object_id
  UNION ALL
  SELECT N'KEY',t.name,k.name,CONCAT(k.type,N'|',i.name,N'|',k.is_system_named) FROM Tables t JOIN sys.key_constraints k ON k.parent_object_id=t.object_id JOIN sys.indexes i ON i.object_id=t.object_id AND i.index_id=k.unique_index_id
  UNION ALL
  SELECT N'INDEX',t.name,i.name,CONCAT(i.type,N'|',i.is_unique,N'|',i.is_disabled,N'|',i.is_hypothetical,N'|',i.ignore_dup_key,N'|',i.is_primary_key,N'|',i.is_unique_constraint,N'|',
    (SELECT STRING_AGG(CONVERT(nvarchar(max),CONCAT(c.name,CASE WHEN ic.is_descending_key=1 THEN N':DESC' ELSE N':ASC' END)),N',') WITHIN GROUP (ORDER BY ic.key_ordinal) FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal>0),N'|',
    (SELECT STRING_AGG(CONVERT(nvarchar(max),c.name),N',') WITHIN GROUP (ORDER BY ic.index_column_id) FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.is_included_column=1),N'|',COALESCE(i.filter_definition,N'NULL'),N'|',i.fill_factor,N'|',i.allow_row_locks,N'|',i.allow_page_locks,N'|',i.is_padded)
  FROM Tables t JOIN sys.indexes i ON i.object_id=t.object_id
  UNION ALL
  SELECT N'FK',OBJECT_NAME(f.parent_object_id),f.name,CONCAT(
    (SELECT STRING_AGG(CONVERT(nvarchar(max),COL_NAME(fc.parent_object_id,fc.parent_column_id)),N',') WITHIN GROUP (ORDER BY fc.constraint_column_id) FROM sys.foreign_key_columns fc WHERE fc.constraint_object_id=f.object_id),N'|',OBJECT_SCHEMA_NAME(f.referenced_object_id),N'.',OBJECT_NAME(f.referenced_object_id),N'|',
    (SELECT STRING_AGG(CONVERT(nvarchar(max),COL_NAME(fc.referenced_object_id,fc.referenced_column_id)),N',') WITHIN GROUP (ORDER BY fc.constraint_column_id) FROM sys.foreign_key_columns fc WHERE fc.constraint_object_id=f.object_id),N'|',f.delete_referential_action,N'|',f.update_referential_action,N'|',f.is_disabled,N'|',f.is_not_trusted,N'|',f.is_not_for_replication,N'|',f.is_system_named)
  FROM sys.foreign_keys f WHERE f.parent_object_id IN (SELECT object_id FROM Tables) OR f.referenced_object_id IN (SELECT object_id FROM Tables)
  UNION ALL
  SELECT N'TRIGGER',t.name,tr.name,CONVERT(nvarchar(max),tr.type) FROM Tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id
  UNION ALL
  SELECT N'NAME_COLLISION',OBJECT_SCHEMA_NAME(o.object_id),o.name,CONVERT(nvarchar(max),o.type)
  FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN ConstraintOwners e ON o.name=e.name
  WHERE s.name=N'uqp' AND (OBJECT_NAME(o.parent_object_id) COLLATE ${bin2}<>e.table_name COLLATE ${bin2} OR o.parent_object_id=0)
  UNION ALL
  SELECT N'UNKNOWN_CHILD',o.name,ch.name,CONVERT(nvarchar(max),ch.type) FROM Targets o JOIN sys.objects ch ON ch.parent_object_id=o.object_id WHERE ch.type NOT IN (N'PK',N'UQ',N'F',N'C',N'D',N'TR',N'TA')
  UNION ALL
  SELECT N'SEQUENCE',N'uqp',s.name,CONCAT(ty.name,N'|',ty.max_length,N'|',s.precision,N'|',s.scale,N'|',CONVERT(varchar(40),s.start_value),N'|',CONVERT(varchar(40),s.increment),N'|',CONVERT(varchar(40),s.minimum_value),N'|',CONVERT(varchar(40),s.maximum_value),N'|',s.is_cycling,N'|',s.is_cached,N'|',COALESCE(CONVERT(varchar(40),s.cache_size),N'NULL'),N'|',CASE WHEN s.system_type_id=s.user_type_id THEN 0 ELSE 1 END)
  FROM sys.sequences s JOIN Targets o ON o.object_id=s.object_id JOIN sys.types ty ON ty.user_type_id=s.user_type_id
), Actual AS (
  SELECT CONVERT(nvarchar(32),category) COLLATE ${bin2} category, CONVERT(nvarchar(128),owner) COLLATE ${bin2} owner,
         CONVERT(nvarchar(128),name) COLLATE ${bin2} name, CONVERT(nvarchar(max),signature) COLLATE ${bin2} signature FROM ActualRaw
), ComparedExpected AS (SELECT *,DATALENGTH(category) l1,DATALENGTH(owner) l2,DATALENGTH(name) l3,DATALENGTH(signature) l4 FROM Expected),
ComparedActual AS (SELECT *,DATALENGTH(category) l1,DATALENGTH(owner) l2,DATALENGTH(name) l3,DATALENGTH(signature) l4 FROM Actual),
Missing AS (SELECT * FROM ComparedExpected EXCEPT SELECT * FROM ComparedActual),
Unexpected AS (SELECT * FROM ComparedActual EXCEPT SELECT * FROM ComparedExpected),
Visibility AS (
  SELECT CASE WHEN HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION')=1
    AND USER_ID()=1 -- conservative full visibility, including potentially hidden inbound FKs/name collisions
    AND CONVERT(varchar(8),SERVERPROPERTY(N'ProductMajorVersion'))='15'
    AND (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID())=150 THEN 1 ELSE 0 END ok
)
SELECT CASE WHEN v.ok<>1 THEN N'REJECTED_UNKNOWN'
  WHEN NOT EXISTS (SELECT 1 FROM Actual) THEN N'NOT_INSTALLED'
  WHEN EXISTS (SELECT 1 FROM Missing) OR EXISTS (SELECT 1 FROM Unexpected)
    OR EXISTS (SELECT 1 FROM Actual GROUP BY category,owner,name,signature HAVING COUNT_BIG(*)>1) THEN N'REJECTED_PARTIAL_OR_DIFFERENT'
  ELSE N'EXACT_MATCH' END CatalogStatus,
  (SELECT COUNT_BIG(*) FROM Missing) MissingDefinitionCount, (SELECT COUNT_BIG(*) FROM Unexpected) UnexpectedDefinitionCount,
  N'NONE' authority, CONVERT(bit,0) runtimeBindVerified, CONVERT(bit,0) deliveryAllowed,
  N'NOT_PROVEN' persistence, CONVERT(bit,0) productionSafetyProven
FROM Visibility v;
`;
}
