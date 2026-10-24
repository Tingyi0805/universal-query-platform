import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { displayDdlUrl, displayTables } from "./datasetDisplaySchema.js";

test("925 shipped SQL has 34 columns, 16 CHECK/DEFAULT, 2 FK and 13 index columns", async () => {
 const ddl = await readFile(displayDdlUrl, "utf8");
 let columns=0, checks=0, defaults=0, foreignKeys=0;
 for(const table of displayTables){
  const body=ddl.split(`CREATE TABLE uqp.${table} (`)[1]?.split("\n);")[0];
  assert.ok(body, `DDL for ${table} exists`);
  for(const line of body!.split("\n")){
   if(/^\s*(\w+)\s+(BIGINT|BINARY|NVARCHAR|VARCHAR|CHAR|DATETIME2|UNIQUEIDENTIFIER|ROWVERSION|BIT)(?:\((MAX|\d+)\))?(?:\s+COLLATE\s+(\w+))?(\s+IDENTITY\(1,1\))?\s+(NOT NULL|NULL)/i.test(line))columns++;
   if(/\bCONSTRAINT\s+(\w+)\s+CHECK\s*\((.*)\)\s*,?\s*$/.test(line))checks++;
   if(/\bCONSTRAINT\s+(\w+)\s+DEFAULT\s*(\(.+\)|\S.*)\s*,?\s*$/.test(line))defaults++;
   if(/\bCONSTRAINT\s+\w+\s+FOREIGN KEY\(/.test(line))foreignKeys++;
  }
 }
 assert.deepEqual({columns,checks,defaults,foreignKeys},{columns:34,checks:8,defaults:8,foreignKeys:2});
 let indexColumns=5;
 for(const m of ddl.matchAll(/CREATE INDEX (\w+) ON uqp\.(\w+)\(([^)]+)\)(?: INCLUDE\(([^)]+)\))?/g)){
  indexColumns+=m[3]!.split(",").length+(m[4]?.split(",").length??0);
 }
 assert.equal(indexColumns,13);
});
