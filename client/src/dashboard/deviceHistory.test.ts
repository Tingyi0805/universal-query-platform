import test from "node:test";
import assert from "node:assert/strict";
import {trustedDeviceHistory,taipeiHistoryHour,type DeviceHistory} from "./deviceHistory";
const data:DeviceHistory={dashboardId:1,deviceId:7,source:"LIVE",items:[{id:"9007199254740993",createdAtUtc:"2026-10-31T00:00:00Z",eventType:"DASHBOARD_DEVICE_SUSPENDED",username:"admin",displayName:"管理者",status:"SUCCESS",errorCode:null}],total:1,page:1,pageSize:20};
test("history rejects different dashboard/device/source and unsafe error payloads",()=>{
 assert.equal(taipeiHistoryHour("1979-07-01T00:00:00Z"),"1979-07-01 09");
 assert.equal(trustedDeviceHistory(data,1,7,"LIVE",1,20),data);
 for(const patch of [{dashboardId:2},{deviceId:8},{source:"ARCHIVE"},{page:2},{total:2},{items:[{...data.items[0],errorCode:"SECRET_TOKEN"}]},{items:[{...data.items[0],eventType:"LOGIN_SUCCESS"}]},{items:[{...data.items[0],status:"UNKNOWN"}]}])assert.throws(()=>trustedDeviceHistory({...data,...patch} as DeviceHistory,1,7,"LIVE",1,20));
});
