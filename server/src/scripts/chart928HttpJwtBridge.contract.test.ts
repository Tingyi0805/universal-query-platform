// 2B-15D-16: static guard for a disposable-only HTTP/JWT -> SQL Issuer
// acceptance. Not a production route, signer, credential or security approval.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED}
  from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
import {CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
  CHART_WRITER_APPROVED_PROCEDURE_SHA256}
  from "../modules/dashboard/dashboardChartWriterBoundary.js";
import {CHART_ISSUER_APPROVED_PROCEDURE_SHA256}
  from "../modules/dashboard/dashboardChartIssuerBoundary.js";

test("2B-15D-16 synthetic route signs ONLY a verified-JWT-derived actor",async()=>{
 const source=await readFile(new URL("./chart928IssuerMacAcceptance.ts",import.meta.url),"utf8");
 const stage=source.indexOf("2B-15D-16: synthetic loopback HTTP");
 const middleware=source.indexOf("createAuthenticateJwt(",stage);
 const route=source.indexOf("app.post(httpPath",middleware);
 const verified=source.indexOf("deriveDormantChartIssuerIntent(req,7,req.body)",route);
 const grant=source.indexOf("const signature=mac(scoped);",verified);
 const issue=source.indexOf("await issueSigned(scoped,signature)",grant);
 assert(stage>=0&&middleware>stage&&route>middleware&&verified>route&&
        grant>verified&&issue>grant,
        "Signing must follow a verified, private JWT-derived actor intent");
 assert.match(source,/loopback.listen\(0,"127\.0\.0\.1",resolve\)/);
 assert.match(source,/const httpPath="\/synthetic-chart-signed-issuer"/);
 assert.match(source,/actor:intent\.ActorId,token:intent\.TokenVersion/);
 assert.match(source,/digest:intent\.ConfigSha256/);
 assert.match(source,/for\(const forged of \[/);
 assert.match(source,/\{actorId:77\},\{ActorId:77\}/);
 assert.match(source,/UPDATE uqp\.AppUser SET IsActive=0 WHERE Id=8/);
 assert.match(source,/CHART_2B15D16_INDEPENDENT_SIGNER_AND_PRODUCTION_BINDING_STILL_BLOCKED/);
 assert.equal(CHART_ATOMIC_CREATE_RUNTIME_ENABLED,false);
 assert.equal(CHART_WRITER_DB_ACTOR_BINDING_APPROVED,false);
 assert.equal(CHART_WRITER_APPROVED_PROCEDURE_SHA256,null);
 assert.equal(CHART_ISSUER_APPROVED_PROCEDURE_SHA256,null);
});
