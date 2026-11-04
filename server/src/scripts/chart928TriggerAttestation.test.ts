import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
 CHART_WRITER_BASE_COLUMNS,CHART_WRITER_SCHEMA_SQL,
 attestChartWriterBaseColumns,ChartWriterSchemaError,
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
