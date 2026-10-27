import { workstationSessionRepositorySql } from "./workstationSessionSqlStatements.js";

/**
 * Transitional fence, not a 926 revocation implementation.
 * Execute inside the writer's OWNED transaction before any business locks/DML.
 * Both old-schema and new writers take the same gate. Any partial/new 926
 * installation blocks legacy mutation rather than leaving sidecars stale.
 */
// Do not add a SELECT result set: inline legacy batches consume their own final
// SELECT as recordset[0], so emitting GateResult would change their semantics.
export const legacyWorkstationWriterFenceSql = workstationSessionRepositorySql.acquireGate
  .replace("SELECT @result AS GateResult;", "") + `
IF @result < 0 THROW 52926, 'WORKSTATION_SECURITY_GATE_DENIED', 1;
IF COALESCE(HAS_PERMS_BY_NAME(N'uqp',N'SCHEMA',N'VIEW DEFINITION'),0)<>1
  THROW 52926, 'LEGACY_WRITER_METADATA_VISIBILITY_REQUIRED', 1;
IF COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRevision') IS NOT NULL
  OR COL_LENGTH(N'uqp.QuickPinPolicy',N'PolicyRowVersion') IS NOT NULL
  OR OBJECT_ID(N'uqp.SharedWorkstationDeviceSession') IS NOT NULL
  OR OBJECT_ID(N'uqp.SharedWorkstationOperatorState') IS NOT NULL
  OR OBJECT_ID(N'uqp.UserQuickPinSecurityBinding') IS NOT NULL
  OR OBJECT_ID(N'uqp.SharedWorkstationPinAttemptState') IS NOT NULL
  OR OBJECT_ID(N'uqp.SharedWorkstationSessionRequest') IS NOT NULL
  OR OBJECT_ID(N'uqp.SharedWorkstationSessionDecision') IS NOT NULL
  OR OBJECT_ID(N'uqp.AccountRevocationRequest') IS NOT NULL
  OR OBJECT_ID(N'uqp.AccountRevocationDecision') IS NOT NULL
  THROW 52926, 'LEGACY_WRITER_926_INTEGRATION_REQUIRED', 1;
IF EXISTS (SELECT 1 FROM uqp.SchemaMigration WHERE FileName=N'926_shared_workstation_session_security.sql')
  THROW 52926, 'LEGACY_WRITER_926_INTEGRATION_REQUIRED', 1;
`;
