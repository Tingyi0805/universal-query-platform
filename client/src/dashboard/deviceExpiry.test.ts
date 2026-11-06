import test from "node:test";
import assert from "node:assert/strict";
import {deviceExpiry,deviceExpiryApplicability} from "./deviceExpiry.js";
const now=Date.parse("2026-10-29T00:00:00Z");
for(const [delta,band,days] of [[30*86400000+1,"ACTIVE",31],[30*86400000,"DUE30",30],[7*86400000+1,"DUE30",8],[7*86400000,"DUE7",7],[1,"DUE7",1],[0,"EXPIRED",0],[-86400000,"EXPIRED",-1]] as const)test(`expiry ${delta}ms`,()=>{const value=deviceExpiry(new Date(now+delta).toISOString(),now);assert.equal(value.band,band);assert.equal(value.days,days);});
test("no expiry and missing/invalid evidence are distinct",()=>{assert.equal(deviceExpiry(null,now).text,"未設定到期日");for(const value of [undefined,"invalid"])assert.equal(deviceExpiry(value,now).band,"UNKNOWN");});
test("reminder classification never grants renewal or playback authority",()=>{assert.equal(deviceExpiry(new Date(now+1000).toISOString(),now).band,"DUE7");assert.equal(deviceExpiry(new Date(now+1000).toISOString(),now+1001).band,"EXPIRED");});

test("terminal devices retain dates but never advertise remaining authorization days",()=>{
 const device={expiresAtUtc:"2099-01-01T00:00:00Z",revokedAtUtc:"2026-01-01T00:00:00Z"};
 assert.equal(deviceExpiryApplicability(device),"不適用（已撤銷）");assert.equal(deviceExpiryApplicability({...device,archivedAtUtc:"2026-02-01T00:00:00Z"}),"不適用（已封存）");assert.equal(deviceExpiryApplicability({}),null);assert.equal(device.expiresAtUtc,"2099-01-01T00:00:00Z");
});
