export const deviceHistoryLabels = {
 DASHBOARD_DEVICE_CREATED:"建立",DASHBOARD_DEVICE_METADATA_UPDATED:"修改基本設定",DASHBOARD_DEVICE_PLACEMENT_UPDATED:"修改播放位置",DASHBOARD_DEVICE_RENEWED:"續期",DASHBOARD_DEVICE_SUSPENDED:"暫停",DASHBOARD_DEVICE_RESTORED_PENDING:"恢復（待重新註冊）",DASHBOARD_DEVICE_TOKEN_ISSUED_PENDING:"核發新憑證（待重新註冊）",DASHBOARD_DEVICE_ENROLLED:"完成註冊",DASHBOARD_DEVICE_REVOKED:"永久撤銷",DASHBOARD_DEVICE_ARCHIVED:"封存",
} as const;
export const publicHistoryErrors=["VALIDATION_ERROR","FORBIDDEN","INVALID_TOKEN","TOKEN_REVOKED","DASHBOARD_DEVICE_VERSION_CONFLICT","DASHBOARD_DEVICE_NOT_EDITABLE","DASHBOARD_DEVICE_NOT_FOUND","DASHBOARD_DEVICE_LIFECYCLE_SCHEMA_REQUIRED","DASHBOARD_DEVICE_AUDIT_REQUIRED","QUERY_DEVICE_DELEGATION_INVALID","QUERY_SOURCE_QUERY_FORBIDDEN","QUERY_SOURCE_PUBLIC_POLICY_REQUIRED"];
export type HistoryFilters={source:"LIVE"|"ARCHIVE";eventType:string;startDate:string;endDate:string;username:string;pageSize:number};
export type HistoryRow={id:string;createdAtUtc:string;eventType:keyof typeof deviceHistoryLabels;username:string|null;displayName:string|null;status:"SUCCESS"|"FAILED"|"STARTED";errorCode:string|null};
export type DeviceHistory={dashboardId:number;deviceId:number;source:"LIVE"|"ARCHIVE";items:HistoryRow[];total:number;page:number;pageSize:number};
export function trustedDeviceHistory(v:DeviceHistory,id:number,deviceId:number,source:string,page:number,pageSize:number){
 if(!v||v.dashboardId!==id||v.deviceId!==deviceId||v.source!==source||v.page!==page||v.pageSize!==pageSize||!Number.isSafeInteger(v.total)||v.total<0||!Array.isArray(v.items)||v.items.length!==Math.min(pageSize,Math.max(0,v.total-(page-1)*pageSize)))throw new Error("DEVICE_HISTORY_INVALID");
 for(const d of v.items){if(!d||typeof d.id!=="string"||!/^[1-9]\d{0,18}$/.test(d.id)||typeof d.createdAtUtc!=="string"||!Number.isFinite(Date.parse(d.createdAtUtc))||!Object.prototype.hasOwnProperty.call(deviceHistoryLabels,d.eventType)||!["SUCCESS","FAILED","STARTED"].includes(d.status)||![d.username,d.displayName].every(s=>s===null||typeof s==="string")||(d.errorCode!==null&&!publicHistoryErrors.includes(d.errorCode)))throw new Error("DEVICE_HISTORY_INVALID");}
 return v;
}

export function taipeiHistoryHour(utc:string){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(utc)).map(p=>[p.type,p.value]));
 return `${parts.year!.padStart(4,"0")}-${parts.month}-${parts.day} ${parts.hour}`;
}
