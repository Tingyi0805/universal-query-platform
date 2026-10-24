/**
 * Dedicated manual 923 installer: preflight / apply / verify.
 * Never runs the generic migration scanner or implicitly adopts a manual install.
 * No runtime policy grants, no Source Fence, no preview unlock.
 */
import sql from "mssql";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPlatformDbPool, closePlatformDbPool } from "../config/database.js";
import { render923CatalogSql, render923Draft } from "../modules/dataset/datasetMetadata923Catalog.js";

const fileName = "923_dataset_metadata.sql";
const prerequisites = [
  "001_platform_identity.sql",
  "002_datasource.sql",
  "006_audit_log.sql",
  "016_audit_retention.sql",
  "019_user_token_version.sql",
  "919_dashboard_dataset_security_contract.sql",
  "920_dataset_definition_rowversion.sql",
  "921_datasource_native_parameter_versions.sql",
] as const;

export type Install923Target = Readonly<{ server: string; database: string; login: string;
  engineMajor: number; compatibility: number; databaseState: string;
  ledger: boolean; missingMigrations: string[]; requiredColumns: boolean;
  existingRecord: boolean; catalog: string;
  dbPrincipalId: number | null; hasViewDefinition: number | null; dbOwnerMember: number | null }>;

export class Install923Error extends Error {
  constructor(readonly code: string) { super(code); this.name = "Install923Error"; }
}

export function assess923Target(t: Install923Target): "READY" | "INSTALLED" {
  if (t.engineMajor !== 15 || t.compatibility !== 150 ||
      t.databaseState !== "ONLINE" || !t.ledger || !t.requiredColumns ||
      t.missingMigrations.length !== 0 ||
      !t.server || !t.database || !t.login)
    throw new Install923Error("923_BASELINE_OR_ENGINE_NOT_READY");
  if (t.catalog === "REJECTED_UNKNOWN") {
    if (t.dbPrincipalId !== 1 || t.hasViewDefinition !== 1)
      throw new Install923Error("923_CATALOG_VISIBILITY_REQUIRES_DBO_AND_VIEW_DEFINITION");
    throw new Install923Error("923_CATALOG_UNKNOWN_WITH_EXPECTED_VISIBILITY");
  }
  if (t.catalog === "EXACT_MATCH" && t.existingRecord) return "INSTALLED";
  if (t.catalog === "NOT_INSTALLED" && !t.existingRecord) return "READY";
  throw new Install923Error("923_PARTIAL_UNRECORDED_OR_UNTRUSTED");
}

function requireTargetAttestation(t: Install923Target) {
  const expectedServer = process.env.UQP_923_EXPECTED_SERVER;
  const expectedDb = process.env.UQP_923_EXPECTED_DATABASE;
  const expectedLogin = process.env.UQP_923_EXPECTED_LOGIN;
  if (!expectedServer || !expectedDb || !expectedLogin ||
    t.server !== expectedServer || t.database !== expectedDb || t.login !== expectedLogin) {
    throw new Install923Error("923_TARGET_ATTESTATION_MISMATCH");
  }
}

async function readTarget(request: () => sql.Request): Promise<Install923Target> {
  const info = await request().query(`
    SELECT @@SERVERNAME AS ServerName, DB_NAME() AS DatabaseName,
      ORIGINAL_LOGIN() AS LoginName,
      USER_ID() AS DatabasePrincipalId,
      HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS HasViewDefinition,
      IS_MEMBER(N'db_owner') AS IsDbOwnerMember,
      TRY_CONVERT(int, SERVERPROPERTY(N'ProductMajorVersion')) AS Major,
      (SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID()) AS Compat,
      (SELECT state_desc FROM sys.databases WHERE database_id=DB_ID()) AS DatabaseState,
      OBJECT_ID(N'uqp.SchemaMigration',N'U') AS LedgerObject,
      CASE WHEN COL_LENGTH(N'uqp.Dataset',N'DefinitionRowVersion')=8
        AND COL_LENGTH(N'uqp.DataSource',N'ConfigurationRowVersion')=8
        AND OBJECT_ID(N'uqp.DatasetNativeParameterContract',N'U') IS NOT NULL
        AND OBJECT_ID(N'uqp.DatasetSensitiveColumn',N'U') IS NOT NULL
        AND OBJECT_ID(N'uqp.DatasetPatientAuditConfig',N'U') IS NOT NULL
        AND OBJECT_ID(N'uqp.AuditLog',N'U') IS NOT NULL
        AND OBJECT_ID(N'uqp.AppUser',N'U') IS NOT NULL
        THEN 1 ELSE 0 END AS PrerequisitesVisible
  `);
  const a = info.recordset[0];
  if (!a || a.LedgerObject == null) throw new Install923Error("923_LEDGER_UNAVAILABLE");
  const applied = await request().query("SELECT FileName FROM uqp.SchemaMigration");
  const names = new Set(applied.recordset.map(row => String(row.FileName)));
  const query = await request().query(render923CatalogSql());
  const catalog = String(query.recordset[0]?.CatalogStatus ?? "REJECTED_UNKNOWN");
  return {
    server: String(a.ServerName ?? ""), database: String(a.DatabaseName ?? ""),
    login: String(a.LoginName ?? ""), engineMajor: Number(a.Major),
    compatibility: Number(a.Compat), databaseState: String(a.DatabaseState),
    ledger: true, missingMigrations: prerequisites.filter(f => !names.has(f)),
    requiredColumns: a.PrerequisitesVisible === 1,
    existingRecord: names.has(fileName), catalog,
    dbPrincipalId: a.DatabasePrincipalId == null ? null : Number(a.DatabasePrincipalId),
    hasViewDefinition: a.HasViewDefinition == null ? null : Number(a.HasViewDefinition),
    dbOwnerMember: a.IsDbOwnerMember == null ? null : Number(a.IsDbOwnerMember),
  };
}

function requireExplicitApproval(args: string[]) {
  if (args.length !== 2 || args[1] !== "--confirm" ||
      process.env.UQP_923_APPROVE_INSTALL !== "I_APPROVE_REBUILT_UQP_923" ||
      process.env.UQP_923_BACKUP_VERIFIED !== "YES") {
    throw new Install923Error("923_EXPLICIT_APPROVAL_AND_BACKUP_REQUIRED");
  }
}

async function run() {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (!["preflight", "apply", "verify"].includes(mode ?? "") ||
    (mode !== "apply" && args.length !== 1))
    throw new Install923Error("923_USAGE_PREPARED_INSTALL_ONLY");
  // Do not even open a connection if the user requested apply without approval.
  if (mode === "apply") requireExplicitApproval(args);

  // Explicit manual operation only: never authorize a default auto-migrator run.
  const pool = await getPlatformDbPool();
  if (!pool) throw new Install923Error("923_PLATFORM_DB_NOT_CONFIGURED");
  try {
    const before = await readTarget(() => pool.request());
    requireTargetAttestation(before);
    if (mode === "preflight") {
      console.log("923_PREFLIGHT_OBSERVATION=" + JSON.stringify({catalog:before.catalog,
        existingRecord:before.existingRecord,missingMigrations:before.missingMigrations,
        requiredColumns:before.requiredColumns,engineMajor:before.engineMajor,
        compatibility:before.compatibility, databaseState:before.databaseState,
        catalogVisibility: {databasePrincipalIsDbo: before.dbPrincipalId === 1,
          canViewDefinition: before.hasViewDefinition === 1,
          isDbOwnerRoleMember: before.dbOwnerMember === 1}}));
      if (before.catalog === "REJECTED_UNKNOWN") {
        console.log("923_PREFLIGHT_HINT=CATALOG_REQUIRES_EFFECTIVE_DBO_USER_AND_VIEW_DEFINITION");
        console.log("923_PREFLIGHT_HINT=USE_A_SEPARATE_INSTALLER_LOGIN_NOT_PERMANENT_UQP_APP_CREDENTIALS");
      }
    }
    const state = assess923Target(before);
    if (mode === "preflight") {
      console.log("923_PREFLIGHT=" + state);
      console.log("923_TARGET=" + JSON.stringify({ server: before.server, database: before.database,
        login: before.login, engineMajor: before.engineMajor, compatibility: before.compatibility }));
      return;
    }
    if (mode === "verify") {
      if (state !== "INSTALLED") throw new Install923Error("923_NOT_INSTALLED_OR_NOT_VERIFIED");
      console.log("923_VERIFY=INSTALLED_EXACT_MATCH_LEDGER_PRESENT");
      return;
    }
    if (state !== "READY") throw new Install923Error("923_ALREADY_INSTALLED_NO_MUTATION");

    const tx = new sql.Transaction(pool);
    let active = false;
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); active = true;
      await new sql.Request(tx).query("SET XACT_ABORT ON");
      const lock = await new sql.Request(tx).query(`
        DECLARE @result int;
        EXEC @result=sys.sp_getapplock
           @Resource=N'UQP_923_SCHEMA_INSTALL',@LockMode=N'Exclusive',
           @LockOwner=N'Transaction',@LockTimeout=5000;
        SELECT @result AS Result;
      `);
      if (Number(lock.recordset[0]?.Result) < 0) throw new Install923Error("923_INSTALL_LOCK_UNAVAILABLE");
      const locked = await readTarget(() => new sql.Request(tx));
      requireTargetAttestation(locked);
      if (assess923Target(locked) !== "READY") throw new Install923Error("923_CONCURRENT_CHANGE");
      const ddl = render923Draft();
      const batches = ddl.split(/;\s*(?:\r?\n|$)/u).map(s => s.trim()).filter(Boolean);
      if (batches.length < 9) throw new Install923Error("923_DDL_NOT_REVIEWED");
      for (const batch of batches) await new sql.Request(tx).batch(batch);
      // Strict catalog match in the SAME transaction before recording completion.
      const result = await new sql.Request(tx).query(render923CatalogSql());
      if (result.recordset[0]?.CatalogStatus !== "EXACT_MATCH") {
        throw new Install923Error("923_INSTALLED_CATALOG_NOT_EXACT");
      }
      await new sql.Request(tx)
        .input("fileName",sql.NVarChar(255),fileName)
        .query("INSERT INTO uqp.SchemaMigration(FileName) VALUES (@fileName)");
      const confirmed = await readTarget(() => new sql.Request(tx));
      requireTargetAttestation(confirmed);
      if (assess923Target(confirmed) !== "INSTALLED") {
        throw new Install923Error("923_LEDGER_AND_CATALOG_NOT_COHERENT");
      }
      await tx.commit(); active = false;
      console.log("923_APPLY=COMMITTED_EXACT_MATCH_NO_DELIVERY_AUTHORITY");
    } catch (error) {
      if (active) {
        try { await tx.rollback(); } catch {
          throw new Install923Error("923_COMMIT_OR_ROLLBACK_UNCERTAIN_VERIFY_MANUALLY");
        }
      }
      throw error;
    }
  } finally {
    await closePlatformDbPool();
  }
}

// Imported test modules must never trigger database access by side effect.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    // Never log SQL connection strings, SQL text, passwords or driver errors.
    const code = error instanceof Install923Error ? error.code : "923_INSTALL_UNEXPECTED_FAILURE_VERIFY_STATE";
    console.error(code);
    process.exitCode = 1;
  });
}
