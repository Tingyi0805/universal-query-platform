import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, verify, constants } from "node:crypto";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { mkdtemp,readFile,writeFile,rm,stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createQueryExcel } from "../modules/export/excelExport.service.js";
const require=createRequire(import.meta.url),driverRequire=createRequire(require.resolve("mssql"));
const tediousRequire=createRequire(driverRequire.resolve("tedious")),identityRequire=createRequire(tediousRequire.resolve("@azure/identity"));
const identity=tediousRequire("@azure/identity"),msal=identityRequire("@azure/msal-node");
const {createHttpHeaders}=identityRequire("@azure/core-rest-pipeline");
const excelRequire=createRequire(require.resolve("exceljs")),uuid=excelRequire("uuid"),tmp=excelRequire("tmp");
const tenant="00000000-0000-4000-8000-000000000075",clientId="00000000-0000-4000-8000-000000000076",scope="https://database.windows.net/.default";
const jwt=(claims:Record<string,unknown>)=>`${Buffer.from('{"alg":"RS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`;
function transport(deny=false){
 const calls:{url:string;form:URLSearchParams}[]=[];
 const token=jwt({aud:"https://database.windows.net",tid:tenant,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)});
 return{calls,token,httpClient:{async sendRequest(request:any){
  const url=new URL(request.url);assert.equal(url.hostname,"login.microsoftonline.com");let value:unknown;
  if(url.pathname.endsWith("/openid-configuration"))value={authorization_endpoint:`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,token_endpoint:`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,issuer:`https://login.microsoftonline.com/${tenant}/v2.0`,jwks_uri:`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,end_session_endpoint:`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout`};
  else if(url.pathname.endsWith("/devicecode"))value={user_code:"SYNTHETIC",device_code:"synthetic-device-code",verification_uri:"https://microsoft.com/devicelogin",expires_in:600,interval:0,message:"Synthetic test code"};
  else if(url.pathname.endsWith("/token")){const form=new URLSearchParams(String(request.body));calls.push({url:request.url,form});value=deny?{error:"invalid_client",error_description:"Synthetic invalid credential",error_codes:[7000215]}:{token_type:"Bearer",expires_in:3600,ext_expires_in:3600,access_token:token,scope:"https://database.windows.net/.default",client_info:Buffer.from(JSON.stringify({uid:"synthetic",utid:tenant})).toString("base64url"),id_token:jwt({aud:clientId,sub:"synthetic",oid:"synthetic",tid:tenant,preferred_username:"synthetic@example.invalid",exp:Math.floor(Date.now()/1000)+3600})};}
  else assert.fail(`Unexpected identity endpoint ${url.pathname}`);
  return{request,status:deny&&url.pathname.endsWith("/token")?400:200,headers:createHttpHeaders({"content-type":"application/json"}),bodyAsText:JSON.stringify(value)};
 }}};
}
test("runtime dependency contract: one Tedious version, patched MSAL/uuid/tmp; ExcelJS stays 4.x",()=>{
 assert.equal(typeof require("odbc").connect,"function");
 assert.equal(require("mssql/package.json").version,"12.7.13");assert.equal(driverRequire("tedious/package.json").version,"20.3.8");
 const typesRequire=createRequire(require.resolve("@types/mssql/package.json"));assert.equal(typesRequire("tedious/package.json").version,"20.3.8");
 assert.equal(tediousRequire("@azure/identity/package.json").version,"4.14.0");assert.equal(identityRequire("@azure/msal-node/package.json").version,"7.1.2");
 assert.equal(require("exceljs/package.json").version,"4.4.0");assert.equal(excelRequire("uuid/package.json").version,"11.1.1");assert.equal(excelRequire("tmp/package.json").version,"0.2.7");
 for(const ctor of [msal.ConfidentialClientApplication,msal.PublicClientApplication])assert.equal(typeof ctor,"function");
});
test("Azure Identity ClientSecretCredential uses real patched MSAL token exchange/repeated calls and rejects invalid credentials",async()=>{
 for(const deny of [false,true]){
  const network=transport(deny),credential=new identity.ClientSecretCredential(tenant,clientId,"synthetic-client-secret",{httpClient:network.httpClient,disableInstanceDiscovery:true});
  if(deny)await assert.rejects(credential.getToken(scope));
  else{assert.equal((await credential.getToken(scope)).token,network.token);assert.equal((await credential.getToken(scope)).token,network.token);assert.equal(network.calls.length,2);}
  assert.equal(network.calls[0]!.form.get("grant_type"),"client_credentials");assert.equal(network.calls[0]!.form.get("client_secret"),"synthetic-client-secret");
 }
});
test("Azure Identity certificate flow signs a real client assertion through MSAL 7",async t=>{
 const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048}),network=transport();
 const directory=await mkdtemp(path.join(tmpdir(),"uqp75-msal-cert-"));t.after(()=>rm(directory,{recursive:true,force:true}));const key=path.join(directory,"key.pem"),certificate=path.join(directory,"cert.pem"),pem=privateKey.export({format:"pem",type:"pkcs8"}).toString();await writeFile(key,pem,{mode:0o600});
 execFileSync("openssl",["req","-x509","-new","-key",key,"-out",certificate,"-days","1","-subj","/CN=UQP Synthetic Credential"],{stdio:"ignore"});
 const credential=new identity.ClientCertificateCredential(tenant,clientId,{certificate:(await readFile(certificate,"utf8"))+pem},{httpClient:network.httpClient,disableInstanceDiscovery:true});
 assert.equal((await credential.getToken(scope)).token,network.token);
 const assertion=network.calls[0]!.form.get("client_assertion")!,[header,payload,signature]=assertion.split(".");assert.equal(JSON.parse(Buffer.from(header!,"base64url").toString()).alg,"PS256");assert(verify("sha256",Buffer.from(`${header}.${payload}`),{key:publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST},Buffer.from(signature!,"base64url")));
 const claims=JSON.parse(Buffer.from(payload!,"base64url").toString());assert.equal(claims.iss,clientId);assert.equal(claims.sub,clientId);
});
test("Azure Identity username/password and authorization-code grant APIs remain compatible",async()=>{
 for(const kind of ["password","code","obo"]){const network=transport();const options={httpClient:network.httpClient,disableInstanceDiscovery:true};
  const credential=kind==="password"?new identity.UsernamePasswordCredential(tenant,clientId,"synthetic@example.invalid","synthetic-password",options):kind==="code"?new identity.AuthorizationCodeCredential(tenant,clientId,"synthetic-client-secret","synthetic-code","https://app.example.invalid/callback",options):new identity.OnBehalfOfCredential({tenantId:tenant,clientId,clientSecret:"synthetic-client-secret",userAssertionToken:jwt({sub:"synthetic-user",aud:clientId,exp:Math.floor(Date.now()/1000)+3600}),...options});
  assert.equal((await credential.getToken(scope)).token,network.token);assert.equal(network.calls[0]!.form.get("grant_type"),kind==="password"?"password":kind==="code"?"authorization_code":"urn:ietf:params:oauth:grant-type:jwt-bearer");
 }
});
test("Excel export round-trip preserves Chinese labels, numeric/date formatting, visibility and aggregation",async()=>{
 const columns:any[]=[{columnName:"NAME",displayLabel:"姓名",displayOrder:1,isVisible:true,width:120,displayFormat:null,alignment:"LEFT",groupOrder:null,aggregateType:"NONE"},{columnName:"AMOUNT",displayLabel:"金額",displayOrder:2,isVisible:true,width:80,displayFormat:"0.00",alignment:"RIGHT",groupOrder:null,aggregateType:"SUM"},{columnName:"DATE",displayLabel:"日期",displayOrder:3,isVisible:true,width:160,displayFormat:"yyyy-mm-dd hh:mm:ss",alignment:"LEFT",groupOrder:null,aggregateType:"NONE"}];
 const date=new Date("2026-10-29T23:59:59.999Z"),bytes=await createQueryExcel("測試/匯出",{columns:[...columns.map(c=>({name:c.columnName})),{name:"OMITTED"}],rows:[{NAME:"王○明",AMOUNT:12.5,DATE:date,OMITTED:"not-exported"}],rowCount:1,truncated:false,elapsedMs:1},columns);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any);const sheet=workbook.worksheets[0]!;assert.equal(sheet.name,"測試_匯出");assert.equal(sheet.getCell("A2").value,"王○明");assert.equal(sheet.getCell("B2").value,12.5);assert.equal(sheet.getCell("B2").numFmt,"0.00");assert.equal((sheet.getCell("C2").value as Date).toISOString(),date.toISOString());assert.equal(sheet.columnCount,3);assert.equal(sheet.getCell("B3").value,12.5);
});
test("ExcelJS actual UUID conditional formatting, patched tmp cleanup, CSV and streaming XLSX read/write",async t=>{
 assert.match(uuid.v4(),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 const directory=await mkdtemp(path.join(tmpdir(),"uqp75-export-"));t.after(()=>rm(directory,{recursive:true,force:true}));
 const temp=await new Promise<{file:string;cleanup:(cb:(error:Error|null)=>void)=>void}>((resolve,reject)=>tmp.file({dir:directory,mode:0o600,discardDescriptor:true},(e:Error|null,file:string,_fd:unknown,cleanup:(cb:(error:Error|null)=>void)=>void)=>e?reject(e):resolve({file,cleanup})));
 if(process.platform!=="win32")assert.equal((await stat(temp.file)).mode&0o777,0o600);assert.equal(path.dirname(temp.file),directory);await new Promise<void>((resolve,reject)=>temp.cleanup(e=>e?reject(e):resolve()));await assert.rejects(stat(temp.file));
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet("Synthetic");sheet.addRows([["姓名","金額"],["中文,含逗號",12.5]]);sheet.addConditionalFormatting({ref:"B2:B2",rules:[{type:"dataBar",cfvo:[{type:"min"},{type:"max"}],gradient:true,priority:1}]});
 const bytes=await workbook.xlsx.writeBuffer(),read=new ExcelJS.Workbook();const archive=await excelRequire("jszip").loadAsync(bytes);assert.match(await archive.file("xl/worksheets/sheet1.xml").async("string"),/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}/);await read.xlsx.load(bytes as any);assert.equal(read.worksheets[0]!.getCell("A2").value,"中文,含逗號");
 const csv=await workbook.csv.writeBuffer(),csvRead=new ExcelJS.Workbook();await csvRead.csv.read(Readable.from([Buffer.from(csv as any)]));assert.equal(csvRead.worksheets[0]!.getCell("A2").value,"中文,含逗號");
 const filename=path.join(directory,"stream.xlsx"),writer=new ExcelJS.stream.xlsx.WorkbookWriter({filename,useSharedStrings:true});writer.addWorksheet("Stream").addRow(["合成資料",900719925]).commit();await writer.commit();assert((await readFile(filename)).length>100);
 const rows:unknown[]=[];for await(const worksheet of new ExcelJS.stream.xlsx.WorkbookReader(filename,{sharedStrings:"cache",worksheets:"emit"})){for await(const row of worksheet)rows.push(row.values);}assert.equal((rows[0] as any)[1],"合成資料");
});

test("Azure DefaultAzureCredential environment chain and MSAL token cache APIs remain usable",async t=>{
 const settings={AZURE_TENANT_ID:tenant,AZURE_CLIENT_ID:clientId,AZURE_CLIENT_SECRET:"synthetic-secret"};const old=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));Object.assign(process.env,settings);t.after(()=>{for(const[key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const network=transport();const credential=new identity.DefaultAzureCredential({httpClient:network.httpClient,disableInstanceDiscovery:true});assert.equal((await credential.getToken(scope)).token,network.token);assert.equal(network.calls[0]!.form.get("grant_type"),"client_credentials");
 const app=new msal.ConfidentialClientApplication({auth:{clientId,authority:`https://login.microsoftonline.com/${tenant}`,clientSecret:"synthetic-secret"}});const cache=app.getTokenCache(),serialized=cache.serialize();cache.deserialize(serialized);assert.equal(cache.serialize(),serialized);
});
test("Azure DeviceCodeCredential exercises PublicClientApplication grant without a real account/network",async()=>{
 const network=transport();const credential=new identity.DeviceCodeCredential({tenantId:tenant,clientId,httpClient:network.httpClient,disableInstanceDiscovery:true,userPromptCallback:()=>{}});assert.equal((await credential.getToken(scope)).token,network.token);assert.equal(network.calls[0]!.form.get("grant_type"),"device_code");
});
