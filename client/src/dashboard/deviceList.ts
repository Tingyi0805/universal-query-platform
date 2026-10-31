import type { ManagedDevice } from "./managementStatus";
export const deviceListLabels = { ALL:"全部",ACTIVE:"有效",SUSPENDED:"暫停",PENDING_REENROLLMENT:"待重新註冊",REVOKED:"已撤銷",ARCHIVED:"已封存",EXPIRED:"已過期",UNVERIFIED:"未驗證" } as const;
export type ListStatus = keyof typeof deviceListLabels;
export type ListDevice = ManagedDevice & {dashboardId:number;deviceName:string;createdByUserId:number;sharedWorkstationId:number|null;enforceIpRestriction:boolean;allowedIp:string|null;allowedCidr:string|null;expiresAtUtc:string|null;archivedAtUtc:string|null;revokedAtUtc:string|null;suspendedAtUtc:string|null;reenrollmentRequired:boolean|null;status:Exclude<ListStatus,"ALL">};
export type DeviceList = {items:ListDevice[];total:number;page:number;pageSize:number;asOfUtc:string;validUntilUtc:string;snapshot:string;sort:"ID_ASC";consistency:"CONTENT_CHECKED_UNTIL_EXPIRY";writeVersionIncluded:false};
export function trustedDeviceList(value:DeviceList,id:number,page:number,pageSize:number,snapshot?:string):DeviceList {
  const date=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v));
  if(!value || value.page!==page || value.pageSize!==pageSize || !Number.isSafeInteger(value.total)||value.total<0 || ![10,20,50,100].includes(pageSize) || value.sort!=="ID_ASC" || value.consistency!=="CONTENT_CHECKED_UNTIL_EXPIRY" || value.writeVersionIncluded!==false || !date(value.asOfUtc)||!date(value.validUntilUtc)||Date.parse(value.validUntilUtc)<=Date.parse(value.asOfUtc)||typeof value.snapshot!=="string"||!value.snapshot||value.snapshot.length>500 || (snapshot!==undefined&&value.snapshot!==snapshot) || !Array.isArray(value.items)||value.items.length!==Math.min(pageSize,Math.max(0,value.total-(page-1)*pageSize)))throw new Error("DEVICE_LIST_INVALID");
  for(const [i,d] of value.items.entries()){
    if(!d||!Number.isSafeInteger(d.id)||d.id<1||d.dashboardId!==id||typeof d.deviceName!=="string"||typeof d.isActive!=="boolean"||!Number.isSafeInteger(d.createdByUserId)||d.createdByUserId<1||(d.sharedWorkstationId!==null&&(!Number.isSafeInteger(d.sharedWorkstationId)||d.sharedWorkstationId<1))||typeof d.enforceIpRestriction!=="boolean"||![d.allowedIp,d.allowedCidr].every(v=>v===null||typeof v==="string")||![d.expiresAtUtc,d.revokedAtUtc,d.archivedAtUtc,d.suspendedAtUtc].every(v=>v===null||date(v))||![null,true,false].includes(d.reenrollmentRequired)||(d.status as string)==="ALL"||!Object.prototype.hasOwnProperty.call(deviceListLabels,d.status)||(i>0&&value.items[i-1]!.id>=d.id))throw new Error("DEVICE_LIST_INVALID");
  }
  return value;
}
