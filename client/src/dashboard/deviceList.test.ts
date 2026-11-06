import test from "node:test";
import assert from "node:assert/strict";
import { trustedDeviceList, deviceListLabels, type DeviceList } from "./deviceList";
const row={id:1,dashboardId:7,deviceName:"安全裝置",createdByUserId:1,sharedWorkstationId:null,isActive:true,enforceIpRestriction:false,allowedIp:null,allowedCidr:null,expiresAtUtc:null,revokedAtUtc:null,archivedAtUtc:null,suspendedAtUtc:null,reenrollmentRequired:null,status:"UNVERIFIED" as const};
const value:DeviceList={items:[row],total:1,page:1,pageSize:20,snapshot:"opaque",asOfUtc:"2026-10-31T00:00:00Z",validUntilUtc:"2026-10-31T00:05:00Z",sort:"ID_ASC",consistency:"CONTENT_CHECKED_UNTIL_EXPIRY",writeVersionIncluded:false};
test("paged DTO validates identity, bounds, ordering and continuation without accepting write versions",()=>{
 assert.equal(trustedDeviceList(value,7,1,20),value);
 for(const patch of [{page:2},{pageSize:100},{sort:"NAME_ASC"},{total:-1},{writeVersionIncluded:true},{snapshot:""},{items:[{...row,dashboardId:8}]},{items:[{...row,status:"UNKNOWN"}]},{items:[row,row],total:2},{total:2},{validUntilUtc:value.asOfUtc}])assert.throws(()=>trustedDeviceList({...value,...patch} as DeviceList,7,1,20));
 assert.throws(()=>trustedDeviceList(value,7,1,20,"old"));
});
test("UNVERIFIED stays separate from ACTIVE and empty ACTIVE is never filled",()=>{
 assert.equal(deviceListLabels.UNVERIFIED,"未驗證");assert.equal(deviceListLabels.ACTIVE,"有效");
 const empty=trustedDeviceList({...value,total:0,items:[]},7,1,20);assert.deepEqual(empty.items,[]);
});
