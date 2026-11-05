import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceSecret, hashDeviceSecret, matchesDeviceSecret } from "./workstationCredential.service.js";

test("workstation secrets are random and match only their own hash", () => {
  const first = createDeviceSecret();
  const second = createDeviceSecret();
  assert.equal(first.length, 43);
  assert.notEqual(first, second);
  assert.equal(matchesDeviceSecret(first, hashDeviceSecret(first)), true);
  assert.equal(matchesDeviceSecret(second, hashDeviceSecret(first)), false);
});

test("rejects malformed credential and malformed hash", () => {
  const secret = createDeviceSecret();
  assert.equal(matchesDeviceSecret("123", hashDeviceSecret(secret)), false);
  assert.equal(matchesDeviceSecret(secret, Buffer.alloc(1)), false);
  assert.equal(matchesDeviceSecret(secret + "x", hashDeviceSecret(secret)), false);
});

test("workstation credential verification rejects disabled/retired/revoked/version-stale credentials",async()=>{
  const {createWorkstationCredentialVerifier,createDeviceSecret,hashDeviceSecret}=await import("./workstationCredential.service.js");
  const secret=createDeviceSecret();
  let row={WorkstationId:1,SecretHash:hashDeviceSecret(secret),IsActive:true,IsRevoked:false,IssuedVersion:1,CredentialVersion:1,RetiredAtUtc:null as string|null};
  const verify=createWorkstationCredentialVerifier(async()=>({request:()=>{const r={input:()=>r,query:async()=>({recordset:[row]})};return r;}}) as unknown as import("mssql").ConnectionPool);
  const id="00000000-0000-4000-8000-000000000001";assert.deepEqual(await verify(id,secret),{workstationId:1});
  const original={...row};
  for(const mutation of [{IsActive:false},{IsRevoked:true},{CredentialVersion:2},{RetiredAtUtc:"synthetic-date"}]){row={...original,...mutation};assert.equal(await verify(id,secret),null);}
});
