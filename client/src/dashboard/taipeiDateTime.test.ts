import test from "node:test";
import assert from "node:assert/strict";
import { parseTaipeiDateTime, taipeiDateTime, validDeviceExpiry } from "./taipeiDateTime";
test("Taipei civil time converts across midnight and leap days without browser timezone",()=>{
  for(const zone of ["UTC","America/Los_Angeles","Asia/Tokyo","Asia/Taipei"]){
    const previous=process.env.TZ;
    try{process.env.TZ=zone;
      assert.equal(parseTaipeiDateTime("2028-02-29 00:01"),"2028-02-28T16:01:00.000Z");
      assert.equal(taipeiDateTime("2028-02-29T23:59:59.123Z"),"2028-03-01 07:59");
      assert.equal(parseTaipeiDateTime("2029-01-01 00:00"),"2028-12-31T16:00:00.000Z");
    }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
  }
});
test("strict minute precision, NULL and invalid civil inputs",()=>{
  assert.equal(parseTaipeiDateTime(""),null);assert.equal(taipeiDateTime(null),"");
  for(const input of ["2027-02-29 10:00","2028-04-31 10:00","2028-00-01 12:00","2028-01-01 24:00","2028-01-01 12:60","2028-01-01 10","2028-01-01 10:00:59","2028-1-01 10:00","invalid"]){assert.throws(()=>parseTaipeiDateTime(input));}
  assert.equal(parseTaipeiDateTime(taipeiDateTime("2028-01-01T00:01:59.123Z")),"2028-01-01T00:01:00.000Z");
});
test("past and exact-now expiries are rejected; NULL policy stays allowed",()=>{
  const now=Date.parse("2028-01-01T00:00:00Z");
  assert.equal(validDeviceExpiry(null,now),true);
  assert.equal(validDeviceExpiry("2027-12-31T23:59:00Z",now),false);
  assert.equal(validDeviceExpiry("2028-01-01T00:00:00Z",now),false);
  assert.equal(validDeviceExpiry("2028-01-01T00:01:00Z",now),true);
  assert.equal(validDeviceExpiry("invalid",now),false);
});
