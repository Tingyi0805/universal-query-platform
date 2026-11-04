// 2B-15C: synthetic fail-closed base catalog regression tests.
// No SQL connection, credentials, migration, production data or runtime activation.
import test from "node:test";
import assert from "node:assert/strict";
import {
 CHART_WRITER_BASE_COLUMNS,CHART_WRITER_BASE_FOREIGN_KEYS,
 CHART_WRITER_SCHEMA_SQL,CHART_WRITER_BASE_FK_SQL,
 ChartWriterSchemaError,attestChartWriterBaseColumns,
 attestChartWriterBaseForeignKeys,
 type ChartWriterBaseColumnRow,type ChartWriterBaseForeignKeyRow,
} from "./chart928WriterBaseSchema.js";

const columns=():ChartWriterBaseColumnRow[]=>
 CHART_WRITER_BASE_COLUMNS.map(x=>({
  TableName:x.table,ColumnName:x.column,SqlType:x.type,
  MaxLength:x.bytes??8,Scale:x.scale,Nullable:x.nullable,IsIdentity:x.identity,
 }));
const foreignKeys=():ChartWriterBaseForeignKeyRow[]=>
 CHART_WRITER_BASE_FOREIGN_KEYS.map(x=>({
  ConstraintName:x.name,ParentSchema:"uqp",ParentTable:x.parent,
  TargetSchema:"uqp",TargetTable:x.target,IsDisabled:false,
  IsNotTrusted:false,DeleteRule:x.deleteRule,KeyColumnCount:1,
  ParentColumn:x.parentColumn,TargetColumn:x.targetColumn,
 }));
const rejects=(code:string,fn:()=>unknown)=>assert.throws(fn,
 (e:unknown)=>e instanceof ChartWriterSchemaError&&e.code===code);
const changedColumn=(key:keyof ChartWriterBaseColumnRow,value:unknown)=>{
 const rows=columns();
 rows[0]={...rows[0]!,[key]:value};
 return rows;
};
const changedFk=(key:keyof ChartWriterBaseForeignKeyRow,value:unknown)=>{
 const rows=foreignKeys();
 rows[0]={...rows[0]!,[key]:value};
 return rows;
};

test("2B-15C exact base catalog passes only when all required rows match",()=>{
 assert.equal(CHART_WRITER_BASE_COLUMNS.length,25);
 assert.equal(CHART_WRITER_BASE_FOREIGN_KEYS.length,3);
 assert.doesNotThrow(()=>attestChartWriterBaseColumns(columns()));
 assert.doesNotThrow(()=>attestChartWriterBaseForeignKeys(foreignKeys()));
 rejects("CHART_BASE_SCHEMA_COLUMN_COUNT",()=>attestChartWriterBaseColumns(
  columns().slice(1)));
 rejects("CHART_BASE_SCHEMA_COLUMN_COUNT",()=>attestChartWriterBaseColumns(
  [...columns(),columns()[0]!]));
 rejects("CHART_BASE_SCHEMA_FK_COUNT",()=>attestChartWriterBaseForeignKeys(
  foreignKeys().slice(1)));
 rejects("CHART_BASE_SCHEMA_FK_COUNT",()=>attestChartWriterBaseForeignKeys(
  [...foreignKeys(),foreignKeys()[0]!]));
});

test("2B-15C missing, hidden, altered and duplicate required columns fail closed",()=>{
 for(const key of ["TableName","ColumnName"] as const){
  rejects("CHART_BASE_SCHEMA_COLUMN_MISSING",()=>attestChartWriterBaseColumns(
   changedColumn(key,"UNEXPECTED")));
 }
 for(const [key,value] of [
  ["SqlType","varchar"],["MaxLength",4],["Nullable",true],
  ["IsIdentity",false],["SqlType",null],["Nullable",null],
 ] as const){
  rejects("CHART_BASE_SCHEMA_COLUMN_MISMATCH",()=>attestChartWriterBaseColumns(
   changedColumn(key,value)));
 }
 const duplicate=columns();
 duplicate[1]={...duplicate[0]!};
 rejects("CHART_BASE_SCHEMA_COLUMN_MISSING",()=>attestChartWriterBaseColumns(duplicate));
 rejects("CHART_BASE_SCHEMA_COLUMN_COUNT",()=>attestChartWriterBaseColumns([]));
});

test("2B-15C FK trust, ownership, target, mapping and cascade are required",()=>{
 rejects("CHART_BASE_SCHEMA_FK_MISSING",()=>attestChartWriterBaseForeignKeys(
  changedFk("ConstraintName","WRONG")));
 for(const [key,value] of [
  ["ParentSchema","dbo"],["ParentTable","OtherTable"],
  ["TargetSchema","dbo"],["TargetTable","OtherParent"],
  ["IsDisabled",true],["IsNotTrusted",true],
  ["DeleteRule","NO_ACTION"],["KeyColumnCount",2],
  ["ParentColumn","WrongParentId"],["TargetColumn","WrongId"],
  ["ParentSchema",null],["IsNotTrusted",null],
 ] as const){
  rejects("CHART_BASE_SCHEMA_FK_MISMATCH",()=>attestChartWriterBaseForeignKeys(
   changedFk(key,value)));
 }
 const duplicate=foreignKeys();
 duplicate[1]={...duplicate[0]!};
 rejects("CHART_BASE_SCHEMA_FK_MISSING",()=>attestChartWriterBaseForeignKeys(duplicate));
});


test("2B-15C datetime2(0) precision cannot drift to datetime2(7)",()=>{
 const target=(x:ChartWriterBaseColumnRow)=>
  x.TableName==="AuditLog"&&x.ColumnName==="CompletedAtUtc";
 assert.equal(columns().find(target)?.Scale,0);
 for(const bad of [7,3,null,undefined,"0"]){
  const altered=columns().map(row=>target(row)?{...row,Scale:bad}:row);
  rejects("CHART_BASE_SCHEMA_COLUMN_MISMATCH",()=>
   attestChartWriterBaseColumns(altered));
 }
 assert.match(CHART_WRITER_SCHEMA_SQL,/c\.scale\s+AS\s+Scale/);
});

test("2B-15C catalog SQL is read-only, schema-scoped and checks FK trust",()=>{
 for(const query of [CHART_WRITER_SCHEMA_SQL,CHART_WRITER_BASE_FK_SQL]){
  assert.match(query,/^SELECT\s/i);
  assert.doesNotMatch(query,/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|EXEC(?:UTE)?)\b/i);
  assert.match(query,/sys\./);
  assert.match(query,/uqp/);
 }
 assert.match(CHART_WRITER_SCHEMA_SQL,/sys\.columns/);
 assert.match(CHART_WRITER_BASE_FK_SQL,/sys\.foreign_key_columns/);
 assert.match(CHART_WRITER_BASE_FK_SQL,/is_not_trusted/);
 assert.match(CHART_WRITER_BASE_FK_SQL,/is_disabled/);
});
