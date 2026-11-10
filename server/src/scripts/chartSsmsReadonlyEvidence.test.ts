// Static safety and source-drift contract for the operator's standalone SSMS
// metadata collection script. This never runs against a hospital database.
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {displayDdlUrl,displayTables} from "../modules/dataset/datasetDisplaySchema.js";

const sourceUrl=new URL(
  "../../../database/acceptance/chart-925-927-928-ssms-readonly-evidence.sql",
  import.meta.url,
);

test("one-pass SSMS evidence uses exactly the 16 reviewed 925 CHECK/DEFAULT names",async()=>{
  const [script,ddl]=await Promise.all([
    readFile(sourceUrl,"utf8"),readFile(displayDdlUrl,"utf8"),
  ]);
  const actual=[...script.matchAll(
    /\(N'(Dataset(?:PublicDisplayPolicy|MaskTemplate|MaskTemplateUse))',N'(CHECK|DEFAULT)',N'([A-Za-z0-9_]+)'\)/g,
  )].map(m=>m[1]+"."+m[2]+"."+m[3]).sort();
  const expected:string[]=[];
  for(const table of displayTables){
    const body=ddl.split("CREATE TABLE uqp."+table+" (")[1]?.split("\n);")[0];
    assert(body);
    for(const m of body.matchAll(/\bCONSTRAINT\s+([A-Za-z_][A-Za-z0-9_]*)\s+(CHECK|DEFAULT)\b/gi))
      expected.push(table+"."+m[2]!.toUpperCase()+"."+m[1]);
  }
  expected.sort();
  assert.equal(expected.length,16);
  assert.deepEqual(actual,expected);
});

test("SSMS evidence refuses unspecified/wrong target and never installs 925/928",async()=>{
  const script=await readFile(sourceUrl,"utf8");
  const executable=script.replace(/\/\*[\s\S]*?\*\//g,"")
    .replace(/--[^\n]*/g,"");
  // T-SQL DECLARE/SET/THROW/SELECT/CTE are allowed; persistent DDL/DML,
  // dynamic SQL and procedure calls are forbidden in this operator file.
  assert.doesNotMatch(executable,
    /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC(?:UTE)?|USE)\b/i);
  assert(script.includes("UQP_CHART_EXPECTED_TARGET_IDENTITY_REQUIRED"));
  assert(script.includes("UQP_CHART_TARGET_IDENTITY_MISMATCH"));
  assert(script.includes("UQP_CHART_REVIEW_METADATA_VISIBILITY_REQUIRED"));
  assert(script.indexOf("UQP_CHART_TARGET_IDENTITY_MISMATCH")<
    script.indexOf("N'00_PINNED_IDENTITY'"));
  assert(script.includes("CONVERT(bit,0) AS MayInstall928"));
  assert(script.includes("CONVERT(bit,0) AS ChartCanBeEnabled"));
  assert(script.includes("EXACT_925_VALIDATOR_STILL_REQUIRED"));
});
