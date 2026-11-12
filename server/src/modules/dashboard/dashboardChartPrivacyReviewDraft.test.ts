// Source-contract safety check for NON-SCANNED 928 disposable SQL only.
// No production DB connection or migration authorization is performed.
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const draftUrl=new URL(
  "../../../../database/drafts/928_dashboard_chart_trust_schema.sql.draft",
  import.meta.url,
);

function triggerBodies(source:string,name:string){
  const installed=source.match(new RegExp(
    "EXEC\\(N'(CREATE TRIGGER uqp\\."+name+"[\\s\\S]*?\\nEND)'\\);",
  ));
  const expected=source.match(new RegExp(
    "\\(N'"+name+"',N'(CREATE TRIGGER uqp\\."+name+"[\\s\\S]*?\\nEND)'\\),",
  ));
  assert(installed?.[1],name+" installed trigger source missing");
  assert(expected?.[1],name+" immutable expected trigger source missing");
  assert.equal(installed[1],expected[1],
    name+" initial installation and exact-body attestation must agree");
  return installed[1];
}

test("draft privacy approval immutability uses BIN2 AND exact string lengths",async()=>{
  const source=await readFile(draftUrl,"utf8");
  assert.match(source,/NON-SCANNED DRAFT/);
  assert.match(source,/CHART_928_DISPOSABLE_ONLY/);
  const body=triggerBodies(source,"TR_ChartReview_Transition");
  for(const field of ["SourceKey","CategoryColumn","ValueColumn"]){
    assert.match(body,new RegExp(
      "i\\."+field+" COLLATE Latin1_General_100_BIN2\\s+<> d\\."+
      field+" COLLATE Latin1_General_100_BIN2",
    ));
    assert.match(body,new RegExp(
      "DATALENGTH\\(i\\."+field+"\\)<>DATALENGTH\\(d\\."+field+"\\)",
    ));
  }
  // Revocation can shorten validity; it may not extend the prior
  // approved expiry, including when the state changes to REVOKED.
  assert.match(body,/d\.Status=''APPROVED''[\s\S]*?i\.ValidUntilUtc>d\.ValidUntilUtc/);
  assert.match(body,/CHART_928_REVIEW_IMMUTABLE/);
});

test("draft request ledger Action immutability is case and padding exact",async()=>{
  const source=await readFile(draftUrl,"utf8");
  const body=triggerBodies(source,"TR_ChartTrustRequest_Immutable");
  assert.match(body,
    /i\.Action COLLATE Latin1_General_100_BIN2\s+<> d\.Action COLLATE Latin1_General_100_BIN2/);
  assert.match(body,/DATALENGTH\(i\.Action\)<>DATALENGTH\(d\.Action\)/);
  assert.match(body,/CHART_928_LEDGER_IMMUTABLE/);
});
