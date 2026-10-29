// Synthetic certificate/channel harness only; not imported by the application.
import express from "express";
import {createServer} from "node:http";
import {createServer as createProxy,connect} from "node:net";
import {randomBytes,X509Certificate} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {once} from "node:events";
import {tmpdir} from "node:os";
import path from "node:path";
import {attachManagedChannel,ManagedAccessDenied} from "./managedChannel.js";
export async function managedFixture(){
 const directory=mkdtempSync(path.join(tmpdir(),"uqp-managed-fixture-"));
 const openssl=(...args:string[])=>execFileSync("openssl",args,{cwd:directory,stdio:"ignore"});
 openssl("req","-x509","-newkey","ec","-pkeyopt","ec_paramgen_curve:P-256","-nodes","-keyout","ca.key","-out","ca.pem","-days","2","-subj","/CN=FixtureCA","-addext","basicConstraints=critical,CA:TRUE");
 for(const name of ["server","client","other"]){
  openssl("req","-new","-newkey","ec","-pkeyopt","ec_paramgen_curve:P-256","-nodes","-keyout",name+".key","-out",name+".csr","-subj",`/CN=${name==="server"?"uqp-kiosk.internal":name}`);
  writeFileSync(path.join(directory,name+".ext"),`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${name==="server"?"serverAuth":"clientAuth"}\n${name==="server"?"subjectAltName=DNS:uqp-kiosk.internal\n":""}`);
  openssl("x509","-req","-in",name+".csr","-CA","ca.pem","-CAkey","ca.key","-CAcreateserial","-out",name+".pem","-days","1","-extfile",name+".ext");
 }
 openssl("pkcs12","-export","-inkey","client.key","-in","client.pem","-certfile","ca.pem","-out","client.pfx","-passout","pass:fixture-only");
 const peer={certificateSha256:new X509Certificate(readFileSync(path.join(directory,"client.pem"))).fingerprint256.replaceAll(":",""),dashboardId:1,deviceId:7,publicOrigin:"http://hospital.example",enrollmentExpiresAtUtc:new Date(Date.now()+12*3600000).toISOString()};
 const configuration={schemaVersion:1 as const,serverCertificate:"server.pem",serverKey:"server.key",clientCa:"ca.pem",peers:[peer]};
 const configFile=path.join(directory,"channel.json");const save=()=>writeFileSync(configFile,JSON.stringify(configuration));save();
 const state={token:randomBytes(32).toString("base64url"),revoked:false,unavailable:false,expired:false,ipDenied:false,policyDenied:false,auditDenied:false,mode:"QUERY_ONLY",revision:4,issued:0,delivered:0,verified:0,unavailableChecks:0,leaked:false};
 let release:undefined|(()=>void),hold=false;
 const app=express();app.use(express.json());
 app.post("/api/auth/login",(req,res)=>{if(req.body.username!=="manager"||req.body.password!=="fixture-secret"){res.status(401).json({error:{code:"INVALID_CREDENTIALS"}});return;}res.json({accessToken:"fixture-session"});});
 app.get("/api/dashboards/1/query-mode/v1",(req,res)=>{if(req.header("authorization")!=="Bearer fixture-session"){res.status(403).end();return;}res.json({mode:"QUERY_ONLY",version:"a".repeat(64)});});
 app.post("/api/dashboards/1/query-mode/v1/devices/7/credential",(req,res)=>{if(req.header("authorization")!=="Bearer fixture-session"||req.body.expectedVersion!=="a".repeat(64)){res.status(409).end();return;}state.issued++;state.token=randomBytes(32).toString("base64url");res.json({device:{id:7,dashboardId:1},token:state.token});});
 app.get("/api/dashboards/1/devices/7/playback-settings",(_req,res)=>res.json({browser:"edge",screenNumber:1,windowX:0,windowY:0,windowWidth:1200,windowHeight:800,fullscreen:false}));
 app.get("/api/dashboards/device/1/layout",(_req,res)=>res.json({deviceAuthorization:{expiresAtUtc:new Date(Date.now()+3600000).toISOString(),serverNowUtc:new Date().toISOString()},profiles:[{id:1,isDefault:true,canvasWidth:1200,canvasHeight:800,config:{},widgets:[{id:1,widgetType:"TABLE",x:0,y:0,width:1000,height:600,fontSize:24,alignment:"LEFT",config:{dataSourceKey:"PRIMARY"},sortOrder:1}]}]}));
 app.post("/api/dashboards/device/1/page",async(_req,res)=>{if(hold)await new Promise<void>(resolve=>{release=resolve;});if(state.auditDenied){res.status(503).json({error:{code:"PATIENT_AUDIT_FAILED"}});return;}state.delivered++;res.json({page:1,totalPages:1,snapshotId:"00000000-0000-4000-8000-000000000001",dashboard:{id:1,name:"Synthetic Agent",pageSize:1,pageSeconds:3600,refreshSeconds:3600,parameters:{}},reportColumns:[],result:{columns:[{name:"DISPLAY"}],rows:[{DISPLAY:"合○Agent"}]}});});
 const outer=createServer((_req,res)=>res.writeHead(404).end());
 const closeChannel=attachManagedChannel(outer,configFile,app,async(binding,token,ip)=>{state.verified++;if(state.unavailable){state.unavailableChecks++;throw new Error("SYNTHETIC_UNAVAILABLE");}if(binding.deviceId!==7||token!==state.token||state.revoked||state.expired||state.ipDenied||state.policyDenied||state.mode!=="QUERY_ONLY"||state.revision!==4||ip!=="127.0.0.1")throw new ManagedAccessDenied("SYNTHETIC_DENIED");});
 outer.listen(0,"127.0.0.1");await once(outer,"listening");const outerPort=(outer.address() as import("node:net").AddressInfo).port;
 let tail=Buffer.alloc(0);const capture=(data:Buffer)=>{const value=Buffer.concat([tail,data]);if([state.token,"fixture-secret","合○Agent"].some(text=>value.includes(Buffer.from(text))))state.leaked=true;tail=value.subarray(-128);};
 const connections=new Set<import("node:net").Socket>();
 const proxy=createProxy(socket=>{const remote=connect(outerPort,"127.0.0.1");for(const s of [socket,remote]){connections.add(s);s.on("close",()=>connections.delete(s));s.on("error",()=>{});s.on("data",capture);}socket.pipe(remote).pipe(socket);});
 proxy.listen(0,"127.0.0.1");await once(proxy,"listening");const port=(proxy.address() as import("node:net").AddressInfo).port;
 const control=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on("data",b=>chunks.push(b));req.on("end",()=>{
   if(req.method==="POST"){const input=JSON.parse(Buffer.concat(chunks).toString()||"{}");for(const key of ["revoked","unavailable","expired","ipDenied","policyDenied","auditDenied","mode","revision"] as const)if(key in input)(state as Record<string,unknown>)[key]=input[key];}
   res.setHeader("content-type","application/json");res.end(JSON.stringify({issued:state.issued,delivered:state.delivered,verified:state.verified,unavailableChecks:state.unavailableChecks,leaked:state.leaked,revoked:state.revoked}));
  });
 });control.listen(0,"127.0.0.1");await once(control,"listening");const controlPort=(control.address() as import("node:net").AddressInfo).port;
 const agent={ChannelEndpoint:`http://127.0.0.1:${port}`,PublicPlaybackUrl:"http://hospital.example/display/dashboards/1?deviceId=7",ServerCertificateSha256:new X509Certificate(readFileSync(path.join(directory,"server.pem"))).fingerprint256.replaceAll(":",""),DashboardId:1,DeviceId:7,Placement:{ScreenNumber:1,WindowX:0,WindowY:0,WindowWidth:1200,WindowHeight:800,Fullscreen:false}};
 writeFileSync(path.join(directory,"agent.json"),JSON.stringify(agent));
 return{directory,port,controlPort,agent,configuration,state,save,hold:()=>{hold=true;},release:()=>{hold=false;release?.();},close:()=>{closeChannel();for(const s of connections)s.destroy();proxy.close();control.closeAllConnections();control.close();outer.closeAllConnections();outer.close();rmSync(directory,{recursive:true,force:true});}};
}
if(process.argv.includes("--serve-managed-fixture")){
 const fixture=await managedFixture();process.stdout.write(JSON.stringify({directory:fixture.directory,port:fixture.port,controlPort:fixture.controlPort})+"\n");
 for(const signal of ["SIGTERM","SIGINT"] as const)process.on(signal,()=>{fixture.close();process.exit();});
}
