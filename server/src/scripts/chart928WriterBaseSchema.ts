// 2B-15C: read-only minimum BASE schema proof for a future CHART writer.
// This is NOT a 925/928 installation gate or permission to deploy.
// Column expectations derive from migrations 001,006,016,019,022,024.
import sql from "mssql";

type ColumnRule=Readonly<{
 table:string;column:string;type:string;bytes:number|null;
 nullable:boolean;identity:boolean;
}>;
const col=(table:string,column:string,type:string,bytes:number|null,
 nullable=false,identity=false):ColumnRule=>
 ({table,column,type,bytes,nullable,identity});

export const CHART_WRITER_BASE_COLUMNS:readonly ColumnRule[]=[
 col("AppUser","Id","bigint",8,false,true),
 col("AppUser","IsActive","bit",1),
 col("AppUser","TokenVersion","int",4),
 col("DashboardDisplayProfile","Id","bigint",8,false,true),
 col("DashboardDisplayProfile","DashboardId","bigint",8),
 col("DashboardWidget","Id","bigint",8,false,true),
 col("DashboardWidget","ProfileId","bigint",8),
 col("DashboardWidget","WidgetType","nvarchar",60),
 col("DashboardWidget","SourceKey","nvarchar",512,true),
 col("DashboardWidget","ConfigJson","nvarchar",-1),
 col("DashboardWidget","X","int",4),
 col("DashboardWidget","Y","int",4),
 col("DashboardWidget","Width","int",4),
 col("DashboardWidget","Height","int",4),
 col("DashboardWidget","FontSize","int",4),
 col("DashboardWidget","Alignment","nvarchar",20),
 col("DashboardWidget","SortOrder","int",4),
 col("AuditLog","Id","bigint",8,false,true),
 col("AuditLog","EventType","nvarchar",100),
 col("AuditLog","EventCategory","nvarchar",40),
 col("AuditLog","Status","nvarchar",40),
 col("AuditLog","UserId","bigint",8,true),
 col("AuditLog","IsImportant","bit",1),
 col("AuditLog","ParametersJson","nvarchar",-1,true),
 col("AuditLog","CompletedAtUtc","datetime2",null,true),
];

export type ChartWriterBaseColumnRow=Readonly<{
 TableName:unknown;ColumnName:unknown;SqlType:unknown;
 MaxLength:unknown;Nullable:unknown;IsIdentity:unknown;
}>;
export class ChartWriterSchemaError extends Error{
 constructor(readonly code:string){super(code);this.name="ChartWriterSchemaError";}
}
export const CHART_WRITER_SCHEMA_SQL=[
 "SELECT r.TableName,r.ColumnName,ty.name AS SqlType,",
 "c.max_length AS MaxLength,CONVERT(bit,c.is_nullable) AS Nullable,",
 "CONVERT(bit,c.is_identity) AS IsIdentity",
 "FROM (VALUES",
 CHART_WRITER_BASE_COLUMNS.map(x=>"(N'"+x.table+"',N'"+x.column+"')").join(","),
 ") AS r(TableName,ColumnName)",
 "LEFT JOIN sys.schemas sc ON sc.name=N'uqp'",
 "LEFT JOIN sys.tables t ON t.schema_id=sc.schema_id AND t.name=r.TableName",
 "LEFT JOIN sys.columns c ON c.object_id=t.object_id AND c.name=r.ColumnName",
 "LEFT JOIN sys.types ty ON ty.user_type_id=c.user_type_id",
].join(" ");
// Base FK protection is required for Widget/Profile and for Audit ownership.
// Source: 022_dashboard_layout_designer.sql and 006_audit_log.sql.
export const CHART_WRITER_BASE_FOREIGN_KEYS=[
 {name:"FK_DashboardDisplayProfile_Dashboard",parent:"DashboardDisplayProfile",
  target:"Dashboard",deleteRule:"CASCADE"},
 {name:"FK_DashboardWidget_Profile",parent:"DashboardWidget",
  target:"DashboardDisplayProfile",deleteRule:"CASCADE"},
 {name:"FK_AuditLog_User",parent:"AuditLog",
  target:"AppUser",deleteRule:"NO_ACTION"},
] as const;
export type ChartWriterBaseForeignKeyRow=Readonly<{
 ConstraintName:unknown;ParentSchema:unknown;ParentTable:unknown;
 TargetSchema:unknown;TargetTable:unknown;IsDisabled:unknown;
 IsNotTrusted:unknown;DeleteRule:unknown;
}>;
export const CHART_WRITER_BASE_FK_SQL=[
 "SELECT expected.ConstraintName,",
 "OBJECT_SCHEMA_NAME(f.parent_object_id) AS ParentSchema,",
 "OBJECT_NAME(f.parent_object_id) AS ParentTable,",
 "OBJECT_SCHEMA_NAME(f.referenced_object_id) AS TargetSchema,",
 "OBJECT_NAME(f.referenced_object_id) AS TargetTable,",
 "CONVERT(bit,f.is_disabled) AS IsDisabled,",
 "CONVERT(bit,f.is_not_trusted) AS IsNotTrusted,",
 "f.delete_referential_action_desc AS DeleteRule",
 "FROM (VALUES",
 CHART_WRITER_BASE_FOREIGN_KEYS.map(x=>"(N'"+x.name+"')").join(","),
 ") AS expected(ConstraintName)",
 "LEFT JOIN sys.foreign_keys f ON f.name=expected.ConstraintName",
 "AND f.schema_id=SCHEMA_ID(N'uqp')",
].join(" ");

export function attestChartWriterBaseForeignKeys(
 rows:readonly ChartWriterBaseForeignKeyRow[],
):void{
 if(!Array.isArray(rows)||rows.length!==CHART_WRITER_BASE_FOREIGN_KEYS.length)
  throw new ChartWriterSchemaError("CHART_BASE_SCHEMA_FK_COUNT");
 for(const expected of CHART_WRITER_BASE_FOREIGN_KEYS){
  const found=rows.filter(r=>r.ConstraintName===expected.name);
  if(found.length!==1)
   throw new ChartWriterSchemaError("CHART_BASE_SCHEMA_FK_MISSING");
  const actual=found[0]!;
  if(actual.ParentSchema!=="uqp"||actual.TargetSchema!=="uqp"||
    actual.ParentTable!==expected.parent||actual.TargetTable!==expected.target||
    actual.IsDisabled!==false||actual.IsNotTrusted!==false||
    actual.DeleteRule!==expected.deleteRule)
   throw new ChartWriterSchemaError("CHART_BASE_SCHEMA_FK_MISMATCH");
 }
}

/** Exact required column shape; unknown, missing, duplicate or hidden SQL
 * metadata is a hard failure. Other optional columns are not rejected.
 */
export function attestChartWriterBaseColumns(
 rows:readonly ChartWriterBaseColumnRow[],
):void{
 if(!Array.isArray(rows)||rows.length!==CHART_WRITER_BASE_COLUMNS.length)
  throw new ChartWriterSchemaError("CHART_BASE_SCHEMA_COLUMN_COUNT");
 for(const want of CHART_WRITER_BASE_COLUMNS){
  const found=rows.filter(x=>x.TableName===want.table&&x.ColumnName===want.column);
  if(found.length!==1)
   throw new ChartWriterSchemaError("CHART_BASE_SCHEMA_COLUMN_MISSING");
  const row=found[0]!;
  if(row.SqlType!==want.type||
    (want.bytes!==null&&row.MaxLength!==want.bytes)||
    row.Nullable!==want.nullable||row.IsIdentity!==want.identity)
   throw new ChartWriterSchemaError("CHART_BASE_SCHEMA_COLUMN_MISMATCH");
 }
}
export async function attestChartWriterBaseSqlCatalog(
 connection:sql.ConnectionPool|sql.Transaction,
):Promise<void>{
 try{
  const request=connection instanceof sql.Transaction
   ? new sql.Request(connection) : new sql.Request(connection);
  const rows=(await request.query(CHART_WRITER_SCHEMA_SQL)).recordset;
  attestChartWriterBaseColumns(rows);
  const fks=(await request.query(CHART_WRITER_BASE_FK_SQL)).recordset;
  attestChartWriterBaseForeignKeys(fks);
 }catch(e){
  if(e instanceof ChartWriterSchemaError)throw e;
  throw new ChartWriterSchemaError("CHART_BASE_SCHEMA_UNAVAILABLE");
 }
}
