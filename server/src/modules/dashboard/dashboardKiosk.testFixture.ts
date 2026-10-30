// Synthetic-only harness; never imported by the application.
import express from "express";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import { createKioskRouter } from "./dashboardKiosk.routes.js";
import { validateProxyRequest } from "../../utils/clientIp.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { env } from "../../config/env.js";
export function kioskFixture() {
 const state={revoked:false,expired:false,ipDenied:false,delegationDenied:false,policyDenied:false,auditDenied:false,mode:"QUERY_ONLY",version:4,token:"A".repeat(43),expires:Date.now()+86400000 as number|null,inspected:0,delivered:0,seenIp:"",patientAuditIp:"",requiredIp:null as string|null,proxyClientEndpoint:"198.51.100.8:54321"};
 const config={origin:"https://kiosk.test",key:"a1".repeat(32),enabled:true,trustedProxies:["127.0.0.1","::1"]};
 const app=express();app.use(validateProxyRequest);app.use(express.json());app.post("/test/state",(req,res)=>{Object.assign(state,req.body);res.json({ok:true});});
 app.get("/test/status",(_req,res)=>res.json({delivered:state.delivered,seenIp:state.seenIp,patientAuditIp:state.patientAuditIp}));
 app.use("/api/dashboards",createKioskRouter(()=>config,{
  check:async(id,token,ip)=>{state.seenIp=ip;
   if(id!==1||token!==state.token)return{status:"INVALID_TOKEN"};if(state.revoked||state.delegationDenied)return{status:"DISABLED"};if(state.expired||(state.expires!==null&&state.expires<=Date.now()))return{status:"EXPIRED"};if(state.ipDenied||state.requiredIp!==null&&state.requiredIp!==ip)return{status:"IP_RESTRICTED"};
   return{status:"VALID",device:{id:7,dashboardId:1,deviceName:"Synthetic",isActive:true,enforceIpRestriction:false,allowedIp:null,allowedCidr:null,expiresAtUtc:state.expires===null?null:new Date(state.expires).toISOString(),lastUsedAtUtc:null,createdByUserId:2,queryModeGrantVersion:4,delegatorTokenVersion:3,authorizationRevision:3,createdAtUtc:null,revokedAtUtc:null,archivedAtUtc:null}};
  },mode:async()=>({mode:state.mode,version:state.version}),inspect:async(_id,subject)=>{state.inspected++;await subject.verifyDevice!();if(state.policyDenied)throw new Error("SYNTHETIC_PRIVATE_POLICY");}
 }));
 app.use("/api/dashboards/device/1",(req,res,next)=>{
  if(!["/layout","/page"].includes(req.path)){next();return;}
  if(req.header("x-dashboard-device-token")!==state.token||state.revoked||state.expired||state.ipDenied||state.delegationDenied||(state.expires!==null&&state.expires<=Date.now())||state.mode!=="QUERY_ONLY"||state.version!==4){res.status(401).json({error:{code:"DASHBOARD_DEVICE_UNAUTHORIZED"}});return;}
  if(state.policyDenied){res.status(403).json({error:{code:"QUERY_SOURCE_PUBLIC_POLICY_REQUIRED"}});return;}next();
 });
 app.get("/api/dashboards/device/1/layout",(_req,res)=>res.json({deviceAuthorization:{expiresAtUtc:state.expires===null?null:new Date(state.expires).toISOString(),serverNowUtc:new Date().toISOString()},profiles:[{id:1,dashboardId:1,name:"Synthetic",canvasWidth:1920,canvasHeight:1080,isDefault:true,sortOrder:1,config:{},widgets:[{id:1,profileId:1,widgetType:"TABLE",title:null,sourceKey:null,staticText:null,x:0,y:0,width:900,height:500,fontSize:24,alignment:"LEFT",config:{dataSourceKey:"PRIMARY"},sortOrder:1}]}]}));
 app.post("/api/dashboards/device/1/page",(req,res)=>{if(state.auditDenied){res.status(503).json({error:{code:"PATIENT_AUDIT_FAILED"}});return;}state.patientAuditIp=auditRequestContext(req).ipAddress??"";state.delivered++;res.json({page:1,totalPages:1,totalRows:1,snapshotId:"synthetic-snapshot",dashboard:{id:1,name:"Synthetic",code:"SYN",parameters:{},pageSize:1,pageSeconds:5,refreshSeconds:5},reportColumns:[{columnName:"DISPLAY",displayLabel:"顯示",displayOrder:1,isVisible:true,alignment:"LEFT"}],result:{columns:[{name:"DISPLAY"}],rows:[{DISPLAY:"合○播放"}]}});});
 return{app,state,config,server:createServer(app)};
}
if(process.argv.includes("--serve-kiosk-fixture")||process.argv.includes("--serve-http-fixture")||process.argv.includes("--serve-arr-fixture")) {
 const insecure=process.argv.includes("--serve-http-fixture");
 const arr=process.argv.includes("--serve-arr-fixture");
 const f=kioskFixture(), directory=mkdtempSync(path.join(tmpdir(),"uqp-kiosk-tls-"));
 const key=path.join(directory,"key.pem"),certificate=path.join(directory,"cert.pem");
 execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",key,"-out",certificate,"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
 f.config.trustedProxies=arr?["127.0.0.1","::1"]:[];
 if(arr){env.TRUST_PROXY_ENABLED=true;env.TRUSTED_PROXY_ADDRESSES=f.config.trustedProxies;}
 f.app.use("/api",(_req,res)=>res.json({}));
 f.app.use((req,res)=>{
  const proxy=httpRequest(`http://127.0.0.1:4173${req.url}`,{method:req.method,headers:{...req.headers,host:"127.0.0.1:4173"}},upstream=>{res.writeHead(upstream.statusCode??502,upstream.headers);upstream.pipe(res);});proxy.on("error",()=>{res.writeHead(502);res.end();});req.pipe(proxy);
 });
 const tls={key:readFileSync(key),cert:readFileSync(certificate)};
 const server=arr?createHttpsServer(tls,(req,res)=>{
  const address=f.server.address() as import("node:net").AddressInfo;
  // Synthetic ARR equivalent: TLS terminates here; only same-host loopback HTTP
  // reaches Node. ARR's append mode deliberately retains a spoofed prefix.
  const forwarded=[req.headers["x-forwarded-for"],f.state.proxyClientEndpoint].filter(Boolean).join(", ");
  if(req.headers.host!==new URL(f.config.origin).host){res.writeHead(400);res.end();return;}
  const proxy=httpRequest(`http://127.0.0.1:${address.port}${req.url}`,{method:req.method,headers:{...req.headers,host:`127.0.0.1:${address.port}`,"x-forwarded-host":req.headers.host,"x-forwarded-for":forwarded,"x-forwarded-proto":"https"}},upstream=>{res.writeHead(upstream.statusCode??502,upstream.headers);upstream.pipe(res);});proxy.on("error",()=>{res.writeHead(502);res.end();});req.pipe(proxy);
 }):insecure?createServer(f.app):createHttpsServer(tls,f.app);
 const cleanup=()=>{server.closeAllConnections();server.close();if(arr){f.server.closeAllConnections();f.server.close();}rmSync(directory,{recursive:true,force:true});process.exit();};process.on("SIGTERM",cleanup);process.on("SIGINT",cleanup);
 const listen=()=>server.listen(0,"127.0.0.1",()=>{const address=server.address();if(address&&typeof address!=="string"){f.config.origin=`${insecure?"http":"https"}://127.0.0.1:${address.port}`;process.stdout.write(`${address.port}\n`);}});
 if(arr)f.server.listen(0,"127.0.0.1",listen);else listen();
}
