import {createHash} from "node:crypto";
import type {ManagedPeer,VerifyManagedDevice} from "./managedChannel.js";
import type {ExecutionSubject} from "../dashboard/dashboardQuerySourceExecution.js";
type Dependencies={check:typeof import("../dashboard/dashboardDevice.repository.js").checkDashboardDisplayDevice;
 mode:(id:number)=>Promise<{mode:string;version:number}>;inspect:(id:number,subject:ExecutionSubject)=>Promise<unknown>};
export function managedDeviceVerifier(deps:Dependencies):VerifyManagedDevice {
 return async(peer:ManagedPeer,token:string,ip:string)=>{
  const current=async()=>{
   const value=await deps.check(peer.dashboardId,token,ip),mode=await deps.mode(peer.dashboardId);
   if(value.status!=="VALID"||value.device.id!==peer.deviceId||mode.mode!=="QUERY_ONLY"||value.device.queryModeGrantVersion!==mode.version||value.device.delegatorTokenVersion!==value.device.authorizationRevision)throw new Error("MANAGED_DEVICE_DENIED");
   return value.device;
  };
  const device=await current();
  await deps.inspect(peer.dashboardId,{context:"device",deviceId:device.id,userId:device.createdByUserId,tokenVersion:device.authorizationRevision,
   tokenHash:createHash("sha256").update(token).digest("hex"),verifyDevice:async()=>{
    const{lastUsedAtUtc:_,...now}=await current();return{deviceId:now.id,userId:now.createdByUserId,tokenVersion:now.authorizationRevision,fingerprint:createHash("sha256").update(JSON.stringify(now)).digest("hex")};
   }});
 };
}
