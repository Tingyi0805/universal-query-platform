import test from "node:test";
import assert from "node:assert/strict";
import { buildSimpleNonPatientRules, simpleReviewSchema, simpleReviewEligible } from "./datasetManagementApproval.simpleReview.js";

const request = {
  expectedDefinitionVersion: "0000000000000001",
  expectedSourceVersion: "0000000000000002",
  expectedPolicyVersion: 0 as const,
  requestId: "c3801140-bc5f-46ed-9df0-720946058b25",
  confirmedNoPatientData: true as const,
  columns: [
    { columnName: "TEST_VALUE", decision: "GENERAL" as const },
    { columnName: "PERSON_NAME", decision: "MASK_ALL" as const },
    { columnName: "IDENTIFIER", decision: "HIDE" as const },
  ],
};
const saved=[{name:"TEST_VALUE"},{name:"PERSON_NAME"},{name:"IDENTIFIER"}];

test("every saved field must be explicitly classified and no new column gets implicit NONE", () => {
  const rules=buildSimpleNonPatientRules(saved, simpleReviewSchema.parse(request));
  assert.deepEqual(rules.map(r=>[r.columnName,r.sensitivityType,r.deviceMaskMode]),[
    ["TEST_VALUE","OTHER","NONE"],["PERSON_NAME","GENERIC","FULL"],["IDENTIFIER","GENERIC","OMIT"]]);
});
test("incomplete, duplicate, unknown or mismatched classification is rejected", () => {
  for (const columns of [request.columns.slice(1),
    [...request.columns,request.columns[0]],
    [...request.columns.slice(0,2),{columnName:"OTHER_FIELD",decision:"HIDE" as const}]]) {
    assert.throws(()=>buildSimpleNonPatientRules(saved,simpleReviewSchema.parse({...request,columns})));
  }
  assert.throws(()=>buildSimpleNonPatientRules([],simpleReviewSchema.parse(request)));
});
test("nonpatient confirmation and revisions are mandatory",()=>{
  for(const body of [{...request,confirmedNoPatientData:false},
    {...request,expectedPolicyVersion:1},
    {...request,expectedDefinitionVersion:"1"},
    {...request,columns:[{columnName:"TEST_VALUE",decision:"UNKNOWN"}]}]) {
    assert.equal(simpleReviewSchema.safeParse(body).success,false);
  }
});

test("first review is blocked when any patient config or historical patient metadata is present", () => {
  assert.equal(simpleReviewEligible(0,0,1,false,"SQLSERVER"),true);
  assert.equal(simpleReviewEligible(0,0,1,true,"SQLSERVER"),false);
  assert.equal(simpleReviewEligible(1,0,1,false,"SQLSERVER"),false);
  assert.equal(simpleReviewEligible(0,0,1,false,"MYSQL"),false);
});
