import test from "node:test";
import assert from "node:assert/strict";
import {assertDatasetAuditOnlyPolicy} from "./datasetAuditOnlyPolicy.js";
for(const mode of ["NONE","CUSTOM","FULL","OMIT"] as const)test(`Query/Dashboard/public confirmation keep the configured audit key internal: ${mode}`,()=>{
 const policy={version:1,columns:[{columnName:"AUDIT_KEY",sensitivityType:"OTHER",deviceMaskMode:mode,customMask:mode==="CUSTOM"?{prefix:0,suffix:0,symbol:"*"}:null}]};
 if(mode==="OMIT")assert.doesNotThrow(()=>assertDatasetAuditOnlyPolicy(policy,"AUDIT_KEY"));else assert.throws(()=>assertDatasetAuditOnlyPolicy(policy,"AUDIT_KEY"));
 assert.doesNotThrow(()=>assertDatasetAuditOnlyPolicy(policy,null));
});
