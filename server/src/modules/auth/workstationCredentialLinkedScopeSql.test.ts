import assert from "node:assert/strict";
import test from "node:test";
import { credentialLinkedOperatorScopeSql as s } from "./workstationCredentialLinkedScopeSql.js";
test("only explicitly linked operator session can be read under credential scope",()=>{
  for (const query of [s.lockScopedOperator,s.lockLinkedLegacy]) {
    assert.match(query,/CredentialId=@credentialId/u);
    assert.match(query,/WorkstationId=CONVERT\(BIGINT,@workstationId\)/u);
    assert.match(query,/UPDLOCK,HOLDLOCK/u);
    assert.doesNotMatch(query,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bCOMMIT\b/iu);
  }
  assert.match(s.lockLinkedLegacy,/os.OperatorSessionId=ls.Id/u);
  assert.match(s.lockLinkedLegacy,/ds.Id=os.DeviceSessionId/u);
  assert.equal(s.unlinkedLegacySessionsProven,false);
  assert.equal(s.runtimeEnabled,false);
});
