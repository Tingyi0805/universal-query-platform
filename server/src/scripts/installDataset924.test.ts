import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {approve924,assess924} from "./installDataset924.js";
import {expected924Catalog,render924CatalogSql,read924Draft} from "../modules/dataset/datasetMetadata924Catalog.js";

test("924 permits absent+unrecorded or exact+recorded only; 923 must remain exact",()=>{
  assert.equal(assess924("NOT_INSTALLED",false,true,false,false),"READY");
  assert.equal(assess924("EXACT_MATCH",true,true,true,true),"INSTALLED");
  for(const [catalog,recorded,base,caps,immutable] of [
    ["NOT_INSTALLED",true,true,false,false],["EXACT_MATCH",false,true,true,true],
    ["EXACT_MATCH",true,false,true,true],["EXACT_MATCH",true,true,false,true],
    ["EXACT_MATCH",true,true,true,false],["REJECTED_PARTIAL_OR_DIFFERENT",false,true,true,true],
    ["REJECTED_UNKNOWN",false,true,true,true],["UNKNOWN",false,true,true,true],
  ] as const)assert.throws(()=>assess924(catalog,recorded,base,caps,immutable));
});
test("924 requires explicit isolated-target, maintenance and backup approval before connecting",()=>{
  const e={UQP_924_APPROVE_INSTALL:"I_APPROVE_ISOLATED_924",UQP_924_BACKUP_VERIFIED:"YES",UQP_924_MAINTENANCE_APPROVED:"YES"};
  assert.doesNotThrow(()=>approve924(["apply","--confirm"],e));
  for(const k of Object.keys(e))assert.throws(()=>approve924(["apply","--confirm"],{...e,[k]:""}));
  assert.throws(()=>approve924(["apply"],e));
});
test("924 CLI rejected invocation cannot connect even when environment has platform credentials",()=>{
  const result=spawnSync(process.execPath,["--import","tsx","src/scripts/installDataset924.ts","apply","--confirm"],{
    env:{...process.env,UQP_924_APPROVE_INSTALL:"",PLATFORM_DB_SERVER:"invalid.invalid",PLATFORM_DB_DATABASE:"FORBIDDEN_TARGET"},encoding:"utf8"});
  assert.notEqual(result.status,0);assert.ok(result.stderr.includes("924_EXPLICIT_ISOLATION_BACKUP_APPROVAL_REQUIRED"));
  assert.ok(!result.stdout.includes("pool connected"));assert.ok(!result.stderr.includes("FORBIDDEN_TARGET"));
});
test("924 exact manifest distinguishes BINARY(8), nullability, PK order, FK trust, CHECK and unexpected objects",()=>{
  const rows=expected924Catalog(),sql=render924CatalogSql();
  assert.equal(rows.filter(r=>r.category==="COLUMN").length,10);
  assert.ok(rows.find(r=>r.name==="ScopeVersion")?.signature.includes("|binary|8|"));
  assert.equal(rows.find(r=>r.category==="ROWVERSION_COUNT")?.signature,"0");
  assert.ok(rows.find(r=>r.category==="INDEX")?.signature.includes("DatasetId:ASC,UserId:ASC,ScopeKind:ASC"));
  assert.equal(rows.filter(r=>r.category==="FK"&&r.signature.endsWith("|0|0|0|0|0|0")).length,2);
  assert.ok(sql.includes("Missing AS")&&sql.includes("Unexpected AS")&&sql.includes("is_not_trusted")&&sql.includes("is_disabled"));
  assert.ok(sql.includes("DATALENGTH(signature)"));
  assert.doesNotMatch(sql.replace(/^--.*$/gm,""),/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXEC)\b/);
});
test("924 draft remains outside scanner, preserves installed 923 and all account/membership data",async()=>{
  const ddl=await read924Draft(),code=ddl.replace(/^\s*--.*$/gm,"");
  assert.doesNotMatch(code,/SchemaMigration|ALTER TABLE|INSERT\s+(?:INTO\s+)?uqp\.(?:AppUser|UserRole|RolePermission|DatasetSecurityScope)\b/i);
  assert.doesNotMatch(code,/REFERENCES uqp\.DatasetSecurityScope\(/);
  assert.match(code,/DENY UPDATE,DELETE ON OBJECT::uqp.DatasetSecurityDecision TO public/);
  assert.equal((await readdir(new URL("../../../database/migrations/",import.meta.url))).filter(f=>f.startsWith("924")).length,0);
});
test("924 Windows wrapper uses separate installer credentials and restores them; no runtime configuration write",async()=>{
  const ps=await readFile(new URL("../../../tools/install-uqp-924.ps1",import.meta.url),"utf8");
  assert.match(ps,/924_SEPARATE_INSTALLER_LOGIN_REQUIRED_NO_RUNTIME_ELEVATION/);
  assert.match(ps,/ZeroFreeBSTR/);assert.match(ps,/finally/);assert.match(ps,/\$previousDbPassword/);
  assert.doesNotMatch(ps,/Set-Content|Out-File|db:migrate/);
});
