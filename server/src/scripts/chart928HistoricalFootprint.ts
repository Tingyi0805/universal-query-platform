// Issue #89: readonly *footprint* for the existing 926 / 927 migrations.
// This is deliberately weaker than exact migration-source attestation.
// It never queries patient/device/PIN contents or grants installation.
export type ChartHistoricalSchemaStatus=
  "ABSENT" | "PARTIAL_OR_CONFLICT" |
  "PRESENT_REQUIRES_EXACT_ATTESTATION" |
  "BLOCKED_BASELINE_MISSING_OR_INVISIBLE";
export type ChartHistoricalLedgerStatus=
  "RECORDED_NOT_ATTESTED" | "NOT_RECORDED";
export type ChartHistoricalConsistency=
  "COHERENT_NOT_ATTESTED" |
  "BLOCKED_LEDGER_CATALOG_CONFLICT" |
  "BLOCKED_PARTIAL_OR_INVISIBLE";
export type ChartHistoricalFootprint=Readonly<{
  schema:926|927;
  status:ChartHistoricalSchemaStatus;
  ledger:ChartHistoricalLedgerStatus;
  consistency:ChartHistoricalConsistency;
  exactAttested:false;
}>;

// Sys-catalog SELECT statements only. A presence check NEVER means exact
// constraint/trigger definition attestation.
export const chartHistoricalFootprintSql=String.raw`
SELECT N'926' AS SchemaNumber,
 CASE
  WHEN OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U') IS NULL
   OR COALESCE(HAS_PERMS_BY_NAME(N'uqp.DashboardDisplayDevice',N'OBJECT',N'VIEW DEFINITION'),0)<>1
    THEN N'BLOCKED_BASELINE_MISSING_OR_INVISIBLE'
  WHEN COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NULL
   AND COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ReenrollmentRequired') IS NULL
   AND NOT EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
    AND name IN (N'CK_DashboardDevice_LifecycleTerminal',N'CK_DashboardDevice_LifecycleSuspended',N'CK_DashboardDevice_LifecycleEnrollment'))
   AND NOT EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
    AND name=N'TR_DashboardDevice_Lifecycle')
    THEN N'ABSENT'
  WHEN COL_LENGTH(N'uqp.DashboardDisplayDevice',N'SuspendedAtUtc') IS NOT NULL
   AND COL_LENGTH(N'uqp.DashboardDisplayDevice',N'ReenrollmentRequired') IS NOT NULL
   AND (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
    AND name IN (N'CK_DashboardDevice_LifecycleTerminal',N'CK_DashboardDevice_LifecycleSuspended',N'CK_DashboardDevice_LifecycleEnrollment')
    AND is_disabled=0 AND is_not_trusted=0 AND is_not_for_replication=0)=3
   AND EXISTS(SELECT 1 FROM sys.triggers t WHERE t.parent_id=OBJECT_ID(N'uqp.DashboardDisplayDevice',N'U')
    AND t.name=N'TR_DashboardDevice_Lifecycle'
    AND t.is_disabled=0 AND t.is_instead_of_trigger=0 AND t.is_not_for_replication=0
    AND (SELECT COUNT(*) FROM sys.trigger_events e WHERE e.object_id=t.object_id)=1
    AND EXISTS(SELECT 1 FROM sys.trigger_events e WHERE e.object_id=t.object_id
      AND e.type_desc=N'UPDATE'))
    THEN N'PRESENT_REQUIRES_EXACT_ATTESTATION'
  ELSE N'PARTIAL_OR_CONFLICT' END AS Assessment
UNION ALL
SELECT N'927' AS SchemaNumber,
 CASE
  WHEN OBJECT_ID(N'uqp.SharedWorkstation',N'U') IS NULL
   OR COALESCE(HAS_PERMS_BY_NAME(N'uqp.SharedWorkstation',N'OBJECT',N'VIEW DEFINITION'),0)<>1
    THEN N'BLOCKED_BASELINE_MISSING_OR_INVISIBLE'
  WHEN COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') IS NULL
   AND OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U') IS NULL
    THEN N'ABSENT'
  WHEN COL_LENGTH(N'uqp.SharedWorkstation',N'SwitchVersion') IS NOT NULL
   AND OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U') IS NOT NULL
   AND EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'uqp.WorkstationPinAttemptBucket',N'U')
    AND name=N'PK_WorkstationPinAttemptBucket'
    AND is_disabled=0 AND is_unique=1 AND is_primary_key=1)
    THEN N'PRESENT_REQUIRES_EXACT_ATTESTATION'
  ELSE N'PARTIAL_OR_CONFLICT' END AS Assessment
ORDER BY SchemaNumber;`;

// Fixed migration filenames only. No table data, application secrets,
// SQL procedure definitions, approval flags or clinical rows are retrieved.
export const chartHistoricalLedgerSql=String.raw`
SELECT FileName FROM uqp.SchemaMigration
WHERE FileName IN (
 N'926_dashboard_device_lifecycle.sql',
 N'927_workstation_pin_runtime.sql'
);`;

const states=new Set<ChartHistoricalSchemaStatus>([
  "ABSENT","PARTIAL_OR_CONFLICT","PRESENT_REQUIRES_EXACT_ATTESTATION",
  "BLOCKED_BASELINE_MISSING_OR_INVISIBLE",
]);
export function parseChartHistoricalFootprints(
  inventory:unknown,ledger:unknown,
):Readonly<{schema926:ChartHistoricalFootprint;schema927:ChartHistoricalFootprint}>{
  if(!Array.isArray(inventory)||inventory.length!==2||
     !Array.isArray(ledger))throw Error("CHART_HISTORICAL_INVENTORY_INVALID");
  const known=new Map<number,ChartHistoricalSchemaStatus>();
  for(const row of inventory){
    if(!row||typeof row!=="object"||Array.isArray(row))
      throw Error("CHART_HISTORICAL_INVENTORY_INVALID");
    const v=row as Record<string,unknown>;
    const schema=Number(v.SchemaNumber);
    if((schema!==926&&schema!==927)||known.has(schema)||
       typeof v.Assessment!=="string"||
       !states.has(v.Assessment as ChartHistoricalSchemaStatus))
      throw Error("CHART_HISTORICAL_INVENTORY_INVALID");
    known.set(schema,v.Assessment as ChartHistoricalSchemaStatus);
  }
  if(known.size!==2)throw Error("CHART_HISTORICAL_INVENTORY_INVALID");
  const recorded=new Set<string>();
  for(const row of ledger){
    if(!row||typeof row!=="object"||Array.isArray(row))
      throw Error("CHART_HISTORICAL_LEDGER_INVALID");
    const file=(row as Record<string,unknown>).FileName;
    if((file!=="926_dashboard_device_lifecycle.sql"&&
        file!=="927_workstation_pin_runtime.sql")||
       recorded.has(file))throw Error("CHART_HISTORICAL_LEDGER_INVALID");
    recorded.add(file);
  }
  const make=(schema:926|927):ChartHistoricalFootprint=>{
    const status=known.get(schema)!;
    const ledger:ChartHistoricalLedgerStatus=recorded.has(schema===926?
      "926_dashboard_device_lifecycle.sql":"927_workstation_pin_runtime.sql")
      ?"RECORDED_NOT_ATTESTED":"NOT_RECORDED";
    const consistency:ChartHistoricalConsistency=
      status==="PARTIAL_OR_CONFLICT"||
      status==="BLOCKED_BASELINE_MISSING_OR_INVISIBLE"
        ?"BLOCKED_PARTIAL_OR_INVISIBLE"
        :(status==="ABSENT"&&ledger==="NOT_RECORDED")||
         (status==="PRESENT_REQUIRES_EXACT_ATTESTATION"&&
          ledger==="RECORDED_NOT_ATTESTED")
          ?"COHERENT_NOT_ATTESTED":"BLOCKED_LEDGER_CATALOG_CONFLICT";
    return Object.freeze({
      schema,status,ledger,consistency,exactAttested:false as const,
    });
  };
  return Object.freeze({schema926:make(926),schema927:make(927)});
}
