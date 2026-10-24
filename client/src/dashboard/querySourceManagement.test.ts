import assert from "node:assert/strict";
import test from "node:test";
import { trustedConfiguration, managementError, previewAuthorizationFailed, sourceSettings, type QuerySourceSettings } from "./querySourceManagement";
const source: QuerySourceSettings = { sourceKey:"A",queryDefinitionId:2,refreshSeconds:30,pageSeconds:15,pageSize:10,maxRows:100 };
test("payload retains parameters but excludes identity and error metadata",()=>{
  const result=sourceSettings({...source,id:3,errorCode:"SYNTHETIC"},'{"FILTER":"SYNTHETIC"}');
  assert.deepEqual(result.parameters,{FILTER:"SYNTHETIC"}); assert.equal("id" in result,false); assert.equal("errorCode" in result,false);
});
test("invalid parameters and numeric settings are rejected",()=>{
  for(const json of ['null','[]','bad','1']) assert.throws(()=>sourceSettings(source,json));
  for(const patch of [{queryDefinitionId:null},{refreshSeconds:4},{pageSize:101},{pageSeconds:3601},{maxRows:10001}]) assert.throws(()=>sourceSettings({...source,...patch},'{}'));
});
test("safe errors exclude SQL and tokens",()=>{
  assert.match(managementError({code:"QUERY_SOURCE_VERSION_CONFLICT",message:"SQL SECRET Token=synthetic"}),/QUERY_SOURCE_VERSION_CONFLICT/);
  assert.doesNotMatch(managementError({code:"SQL SECRET",message:"Token=synthetic"}),/SECRET|Token=/);
});

test("global preview authorization differs from per-Query ACL and parameter failures",()=>{
  assert.equal(previewAuthorizationFailed({status:401}),true);
  assert.equal(previewAuthorizationFailed({status:403,code:"FORBIDDEN"}),true);
  assert.equal(previewAuthorizationFailed({status:403,code:"QUERY_SOURCE_PERMISSION_REVOKED"}),true);
  for(const error of [{status:403,code:"QUERY_SOURCE_QUERY_FORBIDDEN"},{status:400,code:"PARAMETER_REQUIRED"},{status:503},null])assert.equal(previewAuthorizationFailed(error),false);
});

test("managed configuration requires a trusted version and stable source identities", () => {
  const config = { version: "a".repeat(64), editable: false, overCapacity: false, primary: { ...source, sourceKey: "PRIMARY" }, sources: [{ ...source, id: 10 }] };
  const copy = structuredClone(config);
  assert.equal(trustedConfiguration(config), config); assert.deepEqual(config, copy);
  for (const patch of [{version: ""}, {version: undefined}, {editable: undefined}, {primary: source}, {sources: [{...source,id:undefined}]}, {sources: null}]) {
    assert.throws(() => trustedConfiguration({ ...config, ...patch } as any));
  }
});
