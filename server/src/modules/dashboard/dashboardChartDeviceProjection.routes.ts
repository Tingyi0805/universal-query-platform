// Issue #89: independently authenticated public DEVICE CHART projection.
// This is not the designer JWT route. It reuses the existing UQP device
// Token/IP, QUERY_ONLY grant and delegator TokenVersion authorization.
// The production gate is compiled OFF, and the live coordinator also stays
// disabled until independently approved 928, Writer, privacy review and UAT.
import {createHash} from "node:crypto";
import {Router} from "express";
import {z} from "zod";
import {getClientIp} from "../../utils/clientIp.js";
import type {ExecutionSubject} from "./dashboardQuerySourceExecution.js";
import {projectionSchema} from "./dashboardChartProjection.routes.js";

export const CHART_DEVICE_PROJECTION_HTTP_RELEASE_APPROVED=false as const;

type Mode = Readonly<{mode:string;version:number}>;
type AuthorizedDevice = Readonly<{
  id:number;dashboardId:number;createdByUserId:number;
  authorizationRevision:number;queryModeGrantVersion:number|null;
  delegatorTokenVersion:number|null;lastUsedAtUtc?:string|null;
}>;
type CheckResult = Readonly<{status:string;device?:AuthorizedDevice}>;
export type ChartDeviceProjectionDependencies = Readonly<{
  approved:()=>boolean;
  mode:(dashboardId:number)=>Promise<Mode>;
  checkDevice:(dashboardId:number,token:string,sourceIp:string)=>Promise<CheckResult>;
  project:(dashboardId:number,widgetId:number,subject:ExecutionSubject)=>Promise<unknown>;
}>;

const positiveId=z.string().regex(/^[1-9][0-9]{0,14}$/)
  .transform(Number).refine(Number.isSafeInteger);
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;
function emptyRequest(body:unknown):boolean{
  return body===undefined||
    (body!==null&&typeof body==="object"&&!Array.isArray(body)&&
      Object.keys(body).length===0);
}
function deviceFingerprint(device:AuthorizedDevice):string{
  // The legacy device checker may update LastUsedAtUtc while serving a page.
  // It is not an authorization revision; discard only that telemetry field.
  const {lastUsedAtUtc:_lastUsed,...trusted}=device;
  return createHash("sha256").update(JSON.stringify(trusted)).digest("hex");
}

/** Public-device-only transport, mounted before authenticateJwt.
 * Disabled: does not read/query device credentials, SQL or project anything.
 * Enabled by test injection: token/IP and mode/version must still be live,
 * and independently approved public-count policy is enforced by project().
 * Cookie-only kiosk session intentionally has NO route-level fallback.
 */
export function createChartDeviceProjectionRouter(deps:ChartDeviceProjectionDependencies){
  const router=Router();
  router.post("/device/:id/charts/v1/:widgetId/projection",async(req,res)=>{
    res.setHeader("Cache-Control","no-store, max-age=0");
    res.setHeader("Pragma","no-cache");
    if(!deps.approved()){
      res.status(404).json({error:{code:"CHART_NOT_AVAILABLE"}});return;
    }
    const id=positiveId.safeParse(req.params.id);
    const widgetId=positiveId.safeParse(req.params.widgetId);
    const token=req.header("X-Dashboard-Device-Token")??"";
    const ip=getClientIp(req)??"";
    if(!id.success||!widgetId.success||
       Object.keys(req.query).length!==0||!emptyRequest(req.body)){
      res.status(400).json({error:{code:"VALIDATION_ERROR"}});return;
    }
    // No access through cookie-only kiosk or designer Authorization.
    if(!tokenPattern.test(token)||!ip){
      res.status(401).json({error:{code:"DASHBOARD_DEVICE_UNAUTHORIZED"}});return;
    }
    try{
      const expectedDeviceId=req.header("X-UQP-Expected-Device-Id");
      if(expectedDeviceId!==undefined&&expectedDeviceId!==null&&
         (!/^[1-9][0-9]{0,14}$/.test(expectedDeviceId)||
          !positive(Number(expectedDeviceId))))
        throw Error("CHART_DEVICE_EXPECTED_ID_INVALID");
      const originalMode=await deps.mode(id.data);
      if(originalMode.mode!=="QUERY_ONLY"||!positive(originalMode.version))
        throw Error("CHART_DEVICE_QUERY_MODE_REQUIRED");
      const initial=await deps.checkDevice(id.data,token,ip);
      const device=initial.status==="VALID"?initial.device:undefined;
      if(!device||!positive(device.id)||device.dashboardId!==id.data||
         !positive(device.createdByUserId)||
         !positive(device.authorizationRevision)||
         device.queryModeGrantVersion!==originalMode.version||
         device.delegatorTokenVersion!==device.authorizationRevision||
         (expectedDeviceId!=null&&Number(expectedDeviceId)!==device.id))
        throw Error("CHART_DEVICE_GRANT_INVALID");
      const initialFingerprint=deviceFingerprint(device);
      const verifyDevice=async()=>{
        const [mode,current]=await Promise.all([
          deps.mode(id.data),deps.checkDevice(id.data,token,ip),
        ]);
        const now=current.status==="VALID"?current.device:undefined;
        if(mode.mode!=="QUERY_ONLY"||mode.version!==originalMode.version||
           !now||now.id!==device.id||
           now.dashboardId!==id.data||
           now.createdByUserId!==device.createdByUserId||
           now.authorizationRevision!==device.authorizationRevision||
           now.queryModeGrantVersion!==mode.version||
           now.delegatorTokenVersion!==now.authorizationRevision||
           deviceFingerprint(now)!==initialFingerprint)
          throw Error("CHART_DEVICE_GRANT_REVOKED");
        return {deviceId:now.id,userId:now.createdByUserId,
          tokenVersion:now.authorizationRevision,
          fingerprint:initialFingerprint};
      };
      const subject:ExecutionSubject={
        context:"device",userId:device.createdByUserId,
        tokenVersion:device.authorizationRevision,deviceId:device.id,
        tokenHash:createHash("sha256").update(token).digest("hex"),
        verifyDevice,
      };
      // The trusted coordinator MUST use public-count privacy review, live
      // Query permission fences, only audited data and the sealed Widget.
      const projected=await deps.project(id.data,widgetId.data,subject);
      const validated=projectionSchema.safeParse(projected);
      if(!validated.success)throw Error("CHART_DEVICE_PROJECTION_INVALID");
      // Second independently owned recheck after the audited projection:
      // no stale points if device token/IP, version or scope changed mid-page.
      await verifyDevice();
      res.json(validated.data);
    }catch{
      // Never forward SQL/token/IP/Query/patient details in errors.
      res.status(503).json({error:{code:"CHART_TRUSTED_DELIVERY_REQUIRED"}});
    }
  });
  return router;
}
