// One final release-gate regression; no SQL engine or mocked migration used.
// This protects the production installer entrypoint from accidentally
// connecting to a hospital SQL instance before explicit change approval.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_928_OPTION_A_INSTALL_RELEASE_APPROVED,
  installChart928OptionA,
} from "./installChart928OptionA.js";

test("Option A 928 installer stays compiled OFF before any SQL connection",async()=>{
  let connectionCalls=0;
  assert.equal(CHART_928_OPTION_A_INSTALL_RELEASE_APPROVED,false);
  await assert.rejects(
    installChart928OptionA(async()=>{
      connectionCalls++;
      throw Error("MUST_NOT_OPEN_HOSPITAL_SQL");
    }),
    {message:"CHART_928_OPTION_A_INSTALL_NOT_APPROVED"},
  );
  assert.equal(connectionCalls,0);
});
