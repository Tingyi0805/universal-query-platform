// 2B-15C (preflight only): exact enabled SQL trigger definitions from 928
// NON-SCANNED DRAFT. Never use caller-controlled text to authorize CHART.
// This is an isolation attestation, NOT permission to enable a writer.
import {createHash} from "node:crypto";
import sql from "mssql";

export const CHART_928_TRIGGER_TABLES = {
  TR_DashboardWidget_ChartFreeze:"DashboardWidget",
  TR_ChartSeal_DeleteBlock:"DashboardChartWidgetSeal",
  TR_ChartReview_Transition:"DashboardChartPrivacyReview",
  TR_ChartTrustRequest_Immutable:"DashboardChartTrustRequest",
  TR_ChartSeal_AuditReceipt:"DashboardChartWidgetSeal",
  TR_ChartReview_AuditReceipt:"DashboardChartPrivacyReview",
  TR_ChartTrustRequest_AuditReceipt:"DashboardChartTrustRequest",
} as const;

type TriggerName=keyof typeof CHART_928_TRIGGER_TABLES;
export type Chart928TriggerDefinition=Readonly<{name:TriggerName;table:string;definition:string}>;
export type Chart928CatalogRow=Readonly<{
  TriggerName?:unknown;SchemaName?:unknown;ParentSchema?:unknown;
  ParentTable?:unknown;IsDisabled?:unknown;IsInsteadOf?:unknown;
  Definition?:unknown;
}>;
export class Chart928CatalogError extends Error {
  constructor(public readonly code:string) {super(code);this.name="Chart928CatalogError";}
}
const normalize=(value:string)=>value.replace(/\r\n?/g,"\n").replace(/^\uFEFF/,"").trim();
const hash=(s:string)=>createHash("sha256").update(normalize(s),"utf8").digest("hex");

export function parseChart928TriggerDefinitions(draft:string):Chart928TriggerDefinition[] {
  if(typeof draft!=="string"||!draft.includes("NON-SCANNED DRAFT"))
    throw new Chart928CatalogError("CHART_928_SOURCE_NOT_DRAFT");
  const matcher=/EXEC\(N'(CREATE TRIGGER uqp\.(TR_[A-Za-z0-9_]+) ON uqp\.([A-Za-z0-9_]+) AFTER[\s\S]*?\nEND)'\);/g;
  const results:Chart928TriggerDefinition[]=[];
  for(const match of draft.matchAll(matcher)){
    const name=match[2];
    if(!name||!Object.hasOwn(CHART_928_TRIGGER_TABLES,name))
      throw new Chart928CatalogError("CHART_928_UNKNOWN_TRIGGER");
    const trigger=name as TriggerName;
    if(match[3]!==CHART_928_TRIGGER_TABLES[trigger]||results.some(x=>x.name===trigger))
      throw new Chart928CatalogError("CHART_928_SOURCE_TRIGGER_CONFLICT");
    const body=match[1]?.replace(/''/g,"'");
    if(!body||!body.includes("THROW 51928"))
      throw new Chart928CatalogError("CHART_928_SOURCE_TRIGGER_MISSING_FENCE");
    results.push({name:trigger,table:CHART_928_TRIGGER_TABLES[trigger],definition:body});
  }
  if(results.length!==Object.keys(CHART_928_TRIGGER_TABLES).length)
    throw new Chart928CatalogError("CHART_928_SOURCE_TRIGGER_COUNT");
  return results;
}

export function attestChart928TriggerRows(
  rows:readonly Chart928CatalogRow[],
  expected:readonly Chart928TriggerDefinition[],
):void {
  if(rows.length!==expected.length)
    throw new Chart928CatalogError("CHART_928_CATALOG_TRIGGER_COUNT");
  for(const target of expected){
    const matches=rows.filter(row=>row.TriggerName===target.name);
    if(matches.length!==1)
      throw new Chart928CatalogError("CHART_928_CATALOG_TRIGGER_MISSING");
    const actual=matches[0]!;
    if(actual.SchemaName!=="uqp"||actual.ParentSchema!=="uqp"||
       actual.ParentTable!==target.table||
       actual.IsDisabled!==false||actual.IsInsteadOf!==false)
      throw new Chart928CatalogError("CHART_928_CATALOG_TRIGGER_METADATA");
    if(typeof actual.Definition!=="string"||hash(actual.Definition)!==hash(target.definition))
      throw new Chart928CatalogError("CHART_928_CATALOG_TRIGGER_DEFINITION");
  }
}

/** Read-only catalog proof. SQL Server may hide definitions from a low-rights
 * caller; null/hidden definition must fail closed rather than silently pass.
 * Used only by the disposable 2019/2022 preflight until a separately reviewed
 * migration digest and permission boundary have been approved.
 */
export async function attestChart928TriggerCatalog(
  connection:sql.ConnectionPool|sql.Transaction,draft:string,
):Promise<void> {
  const expected=parseChart928TriggerDefinitions(draft);
  const request=connection instanceof sql.Transaction
    ? new sql.Request(connection) : new sql.Request(connection);
  const rows=(await request.query(
    "SELECT t.name AS TriggerName, OBJECT_SCHEMA_NAME(t.object_id) AS SchemaName, " +
    "OBJECT_SCHEMA_NAME(t.parent_id) AS ParentSchema, " +
    "OBJECT_NAME(t.parent_id) AS ParentTable, " +
    "CONVERT(bit,t.is_disabled) AS IsDisabled, " +
    "CONVERT(bit,t.is_instead_of_trigger) AS IsInsteadOf, " +
    "m.definition AS Definition " +
    "FROM sys.triggers t JOIN sys.sql_modules m ON m.object_id=t.object_id " +
    "WHERE t.name IN (" +
    Object.keys(CHART_928_TRIGGER_TABLES).map(name=>"N'"+name+"'").join(",")+")"
  )).recordset;
  attestChart928TriggerRows(rows,expected);
}
