import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 CHART_WRITER_BASE_COLUMNS,CHART_WRITER_SCHEMA_SQL,
 CHART_WRITER_BASE_FOREIGN_KEYS,CHART_WRITER_BASE_FK_SQL,
 attestChartWriterBaseColumns,attestChartWriterBaseForeignKeys,
 ChartWriterSchemaError,
} from "./chart928WriterBaseSchema.js";

import {
  parseChart928TriggerDefinitions,attestChart928TriggerRows,
  CHART_928_TRIGGER_TABLES,Chart928CatalogError,
} from "./chart928TriggerAttestation.js";

const draft=readFileSync(
  new URL("../../../database/drafts/928_dashboard_chart_trust_schema.sql.draft",import.meta.url),
  "utf8",
);
const expected=parseChart928TriggerDefinitions(draft);
const makeRows=()=>expected.map(item=>({
  TriggerName:item.name,SchemaName:"uqp",ParentSchema:"uqp",
  ParentTable:item.table,IsDisabled:false,IsInsteadOf:false,
  Definition:item.definition,
}));
const rejected=(fn:()=>void,code:string)=>{
  assert.throws(fn,(err:unknown)=>
    err instanceof Chart928CatalogError&&err.code===code);
};

test("2B-15C exact 928 Trigger inventory derives only from non-scanned draft",()=>{
  assert.equal(expected.length,7);
  assert.deepEqual(new Set(expected.map(x=>x.name)),new Set(Object.keys(CHART_928_TRIGGER_TABLES)));
  assert.doesNotThrow(()=>attestChart928TriggerRows(makeRows(),expected));
  rejected(()=>parseChart928TriggerDefinitions(draft.replace(
    /EXEC\(N'CREATE TRIGGER uqp\.TR_ChartSeal_DeleteBlock[\s\S]*?\nEND'\);/,""
  )),"CHART_928_SOURCE_TRIGGER_COUNT");
});

test("2B-15C enabled-but-tampered Trigger cannot pass catalog attestation",()=>{
  for(const item of expected){
    const rows=makeRows();
    const row=rows.find(x=>x.TriggerName===item.name)!;
    row.Definition=row.Definition.replace("THROW 51928","PRINT 51928");
    rejected(()=>attestChart928TriggerRows(rows,expected),
      "CHART_928_CATALOG_TRIGGER_DEFINITION");
  }
});

test("2B-15C disabled, instead-of, wrong schema, hidden DDL and missing trigger all fail",()=>{
  const changes:ReadonlyArray<[string,object]>= [
    ["CHART_928_CATALOG_TRIGGER_METADATA",{IsDisabled:true}],
    ["CHART_928_CATALOG_TRIGGER_METADATA",{IsInsteadOf:true}],
    ["CHART_928_CATALOG_TRIGGER_METADATA",{ParentTable:"Dashboard"}],
    ["CHART_928_CATALOG_TRIGGER_METADATA",{SchemaName:"dbo"}],
    ["CHART_928_CATALOG_TRIGGER_DEFINITION",{Definition:null}],
  ];
  for(const [code,change] of changes){
    const rows=makeRows();Object.assign(rows[0]!,change);
    rejected(()=>attestChart928TriggerRows(rows,expected),code);
  }
  rejected(()=>attestChart928TriggerRows(makeRows().slice(1),expected),
    "CHART_928_CATALOG_TRIGGER_COUNT");
});

test("2B-15C base Widget/Audit/Actor schema parity matches migration-owned columns",()=>{
 const rows=CHART_WRITER_BASE_COLUMNS.map(x=>({
   TableName:x.table,ColumnName:x.column,SqlType:x.type,
   MaxLength:x.bytes,Nullable:x.nullable,IsIdentity:x.identity,
 }));
 assert(CHART_WRITER_BASE_COLUMNS.length>=25);
 assert.match(CHART_WRITER_SCHEMA_SQL,/sys\.columns/);
 assert.match(CHART_WRITER_SCHEMA_SQL,/sys\.types/);
 assert.doesNotMatch(CHART_WRITER_SCHEMA_SQL,/\b(?:UPDATE|DELETE|ALTER|GRANT|DROP)\b/i);
 assert.doesNotThrow(()=>attestChartWriterBaseColumns(rows));
 for(const altered of [
   {SqlType:"varchar"},{MaxLength:40},{Nullable:true},{IsIdentity:true},
   {SqlType:null},{Nullable:null},{Identity:null},
 ]){
   const drift=rows.map(row=>({...row}));
   Object.assign(drift.find(row=>row.TableName==="DashboardWidget"&&row.ColumnName==="WidgetType")!,altered);
   assert.throws(()=>attestChartWriterBaseColumns(drift),
     (e:unknown)=>e instanceof ChartWriterSchemaError&&e.code==="CHART_BASE_SCHEMA_COLUMN_MISMATCH");
 }
 assert.throws(()=>attestChartWriterBaseColumns(rows.slice(1)),
   (e:unknown)=>e instanceof ChartWriterSchemaError&&e.code==="CHART_BASE_SCHEMA_COLUMN_COUNT");
 const repeated=[...rows.slice(0,-1),rows[0]!];
 assert.throws(()=>attestChartWriterBaseColumns(repeated),
   (e:unknown)=>e instanceof ChartWriterSchemaError&&e.code==="CHART_BASE_SCHEMA_COLUMN_MISSING");
});

test("2B-15C SQL Widget/Profile/Audit foreign-key trust and cascade are exact",()=>{
 const rows=CHART_WRITER_BASE_FOREIGN_KEYS.map(x=>({
   ConstraintName:x.name,ParentSchema:"uqp",ParentTable:x.parent,
   ParentColumn:x.parentColumn,TargetSchema:"uqp",TargetTable:x.target,
   TargetColumn:x.targetColumn,KeyColumnCount:1,
   IsDisabled:false,IsNotTrusted:false,DeleteRule:x.deleteRule,
 }));
 assert.equal(rows.length,3);
 assert.match(CHART_WRITER_BASE_FK_SQL,/sys\.foreign_keys/);
 assert.match(CHART_WRITER_BASE_FK_SQL,/sys\.foreign_key_columns/);
 assert.doesNotMatch(CHART_WRITER_BASE_FK_SQL,/\b(?:ALTER|DROP|GRANT|DELETE|UPDATE)\b/i);
 assert.doesNotThrow(()=>attestChartWriterBaseForeignKeys(rows));
 for(const change of [
  {ParentSchema:"dbo"},{TargetSchema:"dbo"},{ParentTable:"Dashboard"},
  {TargetTable:"AppUser"},{ParentColumn:"OtherDashboardId"},
  {TargetColumn:"Code"},{KeyColumnCount:2},
  {KeyColumnCount:null},{IsDisabled:true},{IsNotTrusted:true},
  {IsNotTrusted:null},{DeleteRule:"NO_ACTION"},
 ]){
   const altered=rows.map(row=>({...row}));
   Object.assign(altered[0]!,change);
   assert.throws(()=>attestChartWriterBaseForeignKeys(altered),
    (e:unknown)=>e instanceof ChartWriterSchemaError&&
      e.code==="CHART_BASE_SCHEMA_FK_MISMATCH");
 }
 assert.throws(()=>attestChartWriterBaseForeignKeys(rows.slice(1)),
  (e:unknown)=>e instanceof ChartWriterSchemaError&&
    e.code==="CHART_BASE_SCHEMA_FK_COUNT");
 assert.throws(()=>attestChartWriterBaseForeignKeys([rows[0]!,rows[0]!,rows[2]!]),
  (e:unknown)=>e instanceof ChartWriterSchemaError&&
    e.code==="CHART_BASE_SCHEMA_FK_MISSING");
});

test("2B-15C migration-sourced FK column contract remains exact",()=>{
 const audit=readFileSync(
  new URL("../../../database/migrations/006_audit_log.sql",import.meta.url),"utf8");
 const dashboard=readFileSync(
  new URL("../../../database/migrations/022_dashboard_layout_designer.sql",import.meta.url),"utf8");
 const sourceChecks=[
  [audit,/CONSTRAINT\s+FK_AuditLog_User\s+FOREIGN\s+KEY\s*\(UserId\)\s+REFERENCES\s+uqp\.AppUser\s*\(Id\)/i],
  [dashboard,/CONSTRAINT\s+FK_DashboardDisplayProfile_Dashboard\s+FOREIGN\s+KEY\s*\(DashboardId\)\s+REFERENCES\s+uqp\.Dashboard\s*\(Id\)\s+ON\s+DELETE\s+CASCADE/i],
  [dashboard,/CONSTRAINT\s+FK_DashboardWidget_Profile\s+FOREIGN\s+KEY\s*\(ProfileId\)\s+REFERENCES\s+uqp\.DashboardDisplayProfile\s*\(Id\)\s+ON\s+DELETE\s+CASCADE/i],
 ] as const;
 for(const [source,pattern] of sourceChecks)assert.match(source,pattern);
 assert.deepEqual(
  CHART_WRITER_BASE_FOREIGN_KEYS.map(k=>[k.name,k.parentColumn,k.targetColumn,k.deleteRule]),
  [
   ["FK_DashboardDisplayProfile_Dashboard","DashboardId","Id","CASCADE"],
   ["FK_DashboardWidget_Profile","ProfileId","Id","CASCADE"],
   ["FK_AuditLog_User","UserId","Id","NO_ACTION"],
  ]
 );
});
