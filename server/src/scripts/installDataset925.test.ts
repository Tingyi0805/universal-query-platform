import test from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {validate925Invocation} from "./installDataset925.js";
import {displayDdlUrl,exactPositiveId,validateDisplayCatalog} from "../modules/dataset/datasetDisplaySchema.js";
test("925 requires explicit target/confirmation, never picked up by automatic migrations",async()=>{
 for(const args of [[],["apply"],["apply","--no"],["verify","--confirm"]])assert.throws(()=>validate925Invocation(args,{server:"S",database:"D",login:"L"}));
 assert.throws(()=>validate925Invocation(["preflight"],{}));validate925Invocation(["apply","--confirm"],{server:"S",database:"D",login:"L"});
 assert.ok(!(await readdir(new URL("../../../database/migrations",import.meta.url))).some(f=>f.startsWith("925")));
});
test("925 DDL only creates new objects/suggestions; no historical public approvals or Scope",async()=>{const ddl=await readFile(displayDdlUrl,"utf8");assert.doesNotMatch(ddl,/INSERT\s+(?:INTO\s+)?uqp\.(DatasetPublicDisplayPolicy|DatasetSecurityScope)|UPDATE\s+uqp\.|DELETE\s+FROM|ALTER\s+TABLE|SchemaMigration/i);assert.match(ddl,/PublicAllowed BIT NOT NULL.*DEFAULT\(0\)/);});
test("925 catalog absent/partial/invisible fail closed and exact BIGINT is never Number-repaired",async()=>{const ddl=await readFile(displayDdlUrl,"utf8"),absent=[[],[],[],[],[],[],[{visible:1}]];assert.equal(validateDisplayCatalog(absent,ddl),"ABSENT");assert.throws(()=>validateDisplayCatalog([...absent.slice(0,6),[{visible:0}]],ddl));assert.throws(()=>validateDisplayCatalog([[{name:"DatasetPublicDisplayPolicy"}],...absent.slice(1)],ddl));for(const id of [0,9007199254740992,"01","9223372036854775808"])assert.equal(exactPositiveId(id),false);assert.equal(exactPositiveId("9007199254740993"),true);});

test("SQL Server IN expansion compares exactly without erasing CHECK grouping or NULL semantics",async()=>{
 const {canonicalDisplayExpression:c}=await import("../modules/dataset/datasetDisplaySchema.js");
 assert.equal(c("Mode IN ('NONE','CUSTOM','FULL','OMIT')"),c("([Mode]='OMIT' OR [Mode]='FULL' OR [Mode]='CUSTOM' OR [Mode]='NONE')"));
 assert.equal(c("ISJSON(Json)=1 AND Version>0"),c("(([Version]>(0)) AND (isjson([Json])=(1)))"));
 assert.notEqual(c("(Mode='CUSTOM' AND Json IS NOT NULL) OR (Mode<>'CUSTOM' AND Json IS NULL)"),c("Mode='CUSTOM' AND (Json IS NOT NULL OR Mode<>'CUSTOM') AND Json IS NULL"));
 assert.notEqual(c("Json IS NULL"),c("Json = NULL"));assert.notEqual(c("Mode='OMIT'"),c("Mode='omit'"));assert.throws(()=>c("Unknown!()"));
});

test("925 upgrade acceptance preserves the existing 923/924 Audit identity instead of reseeding into its history",async()=>{const source=await readFile(new URL("./datasetDisplay925Acceptance.ts",import.meta.url),"utf8");assert.doesNotMatch(source,/DBCC\s+CHECKIDENT\s*\(\s*'uqp\.AuditLog'/i);assert.match(source,/reason.code,"DATASET_DISPLAY_VERSION_CONFLICT"/);});
