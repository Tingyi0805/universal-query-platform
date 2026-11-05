// 2B-15D-14: ephemeral SQL Server 2019/2022 cryptographic proof fixture.
// NOT a production signer, trusted JWT/HTTP Actor bridge, migration or grant.
// Purpose: prove SQL can verify a short-lived, fully scoped HMAC-SHA256
// issued by an independently controlled signer and reject tampering/replay.
// The same test deliberately leaves the existing synthetic Issuer unsafe.
import assert from "node:assert/strict";
import {createHash,createHmac,randomBytes,randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import express from "express";
import jwt from "jsonwebtoken";
import sql from "mssql";
import {env} from "../config/env.js";
import {createAuthenticateJwt} from "../modules/auth/auth.middleware.js";
import {deriveDormantChartIssuerIntent} from "../modules/dashboard/dashboardChartHttpIssuerHandoff.js";

const forbidden=(error:unknown)=>
  error instanceof Error &&
  Number((error as {number?:unknown}).number)===51928;

type ProofScope=Readonly<{
  actor:number;token:number;dashboard:number;profile:number;
  requestId:string;source:string;digest:string;
  x:number;y:number;width:number;height:number;
  nonce:string;issuedAt:Date;expiresAt:Date;
}>;

const canon=(p:ProofScope)=>[
  "UQP_CHART_ACTOR_V1",
  p.actor,p.token,p.dashboard,p.profile,
  p.requestId.toLowerCase(),p.source,p.digest.toLowerCase(),
  p.x,p.y,p.width,p.height,p.nonce.toLowerCase(),
  p.issuedAt.toISOString().slice(0,23),
  p.expiresAt.toISOString().slice(0,23),
].join("|");

export async function verifyChartIssuerMacDisposable(
  db:sql.ConnectionPool,
):Promise<void>{
  if(process.env.UQP_D1_SCOPE!=="DISPOSABLE_ONLY"||
    !/^uqp-d1-[a-f0-9]{12}$/.test(process.env.UQP_D1_CONTAINER_NAME??"")||
    Object.keys(process.env).some(k=>k.startsWith("PLATFORM_DB_")||k==="DOTENV_CONFIG_PATH"))
    throw Error("CHART_MAC_DISPOSABLE_ONLY");
  const target=(await db.request().query("SELECT DB_NAME() AS Db")).recordset[0]?.Db;
  if(typeof target!=="string"||!/^UQP_CH_[a-f0-9]{12}$/.test(target))
    throw Error("CHART_MAC_TARGET_FORBIDDEN");

  // No static or checked-in key. Pads are HMAC-standard XORed key blocks.
  // SQL only receives the random pads inside this disposable database.
  const key=randomBytes(32);
  const ip=Buffer.alloc(64,0x36),op=Buffer.alloc(64,0x5c);
  for(let i=0;i<key.length;i++){
    ip[i]=(ip[i]??0)^key[i]!;
    op[i]=(op[i]??0)^key[i]!;
  }
  const ddl=String.raw`IF LEFT(DB_NAME(),7)<>N'UQP_CH_' OR LEN(DB_NAME())<>19
 THROW 51928,N'CHART_MAC_DISPOSABLE_ONLY',1;
CREATE TABLE uqp.ChartIssuerMacPadsDisposable(
 KeyId int NOT NULL PRIMARY KEY,
 InnerPad varbinary(64) NOT NULL,OuterPad varbinary(64) NOT NULL
);
CREATE TABLE uqp.ChartIssuerProofNonceDisposable(
 Nonce uniqueidentifier NOT NULL PRIMARY KEY,
 ActorId bigint NOT NULL,ConsumedAtUtc datetime2(3) NOT NULL
);
EXEC(N'CREATE PROCEDURE uqp.usp_ChartIssuerMacVerify_IsolatedDraft
 @ActorId bigint,@TokenVersion int,@DashboardId bigint,@ProfileId bigint,
 @RequestId uniqueidentifier,@SourceKey varchar(64),@ConfigSha256 char(64),
 @X int,@Y int,@Width int,@Height int,@Nonce uniqueidentifier,
 @IssuedAtUtc datetime2(3),@ExpiresAtUtc datetime2(3),
 @Signature varbinary(max)
 WITH EXECUTE AS OWNER
 AS
 BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  IF LEFT(DB_NAME(),7)<>N''UQP_CH_'' OR LEN(DB_NAME())<>19
   THROW 51928,''CHART_MAC_DISPOSABLE_ONLY'',1;
  IF @@TRANCOUNT<>0 OR @ActorId<=0 OR @TokenVersion<1 OR
     @DashboardId<=0 OR @ProfileId<=0 OR @RequestId IS NULL OR
     @Nonce IS NULL OR @SourceKey IS NULL OR
     @SourceKey LIKE ''%[^A-Za-z0-9_]%'' OR
     LEFT(@SourceKey,1) NOT LIKE ''[A-Za-z]'' OR
     @ConfigSha256 NOT LIKE REPLICATE(''[0-9a-f]'',64) OR
     @X<0 OR @Y<0 OR @Width<160 OR @Height<120 OR
     @Signature IS NULL OR DATALENGTH(@Signature)<>32 OR
     @IssuedAtUtc IS NULL OR @ExpiresAtUtc IS NULL
   THROW 51928,''CHART_MAC_SCOPE_INVALID'',1;
  BEGIN TRY
   BEGIN TRAN;
   DECLARE @now datetime2(3)=SYSUTCDATETIME();
   IF @IssuedAtUtc>@now OR @ExpiresAtUtc<=@now OR
      DATEDIFF_BIG(MILLISECOND,@IssuedAtUtc,@ExpiresAtUtc) NOT BETWEEN 1 AND 10000
    THROW 51928,''CHART_MAC_EXPIRED_OR_INVALID'',1;
   DECLARE @message varchar(max)=CONCAT(
     ''UQP_CHART_ACTOR_V1|'',CONVERT(varchar(20),@ActorId),''|'',
     CONVERT(varchar(11),@TokenVersion),''|'',
     CONVERT(varchar(20),@DashboardId),''|'',
     CONVERT(varchar(20),@ProfileId),''|'',
     LOWER(CONVERT(varchar(36),@RequestId)),''|'',
     @SourceKey,''|'',@ConfigSha256,''|'',
     CONVERT(varchar(11),@X),''|'',CONVERT(varchar(11),@Y),''|'',
     CONVERT(varchar(11),@Width),''|'',CONVERT(varchar(11),@Height),''|'',
     LOWER(CONVERT(varchar(36),@Nonce)),''|'',
     CONVERT(varchar(23),@IssuedAtUtc,126),''|'',
     CONVERT(varchar(23),@ExpiresAtUtc,126));
   DECLARE @ipad varbinary(64),@opad varbinary(64);
   SELECT @ipad=InnerPad,@opad=OuterPad
     FROM uqp.ChartIssuerMacPadsDisposable WITH(UPDLOCK,HOLDLOCK) WHERE KeyId=1;
   IF @ipad IS NULL OR @opad IS NULL OR DATALENGTH(@ipad)<>64 OR
      DATALENGTH(@opad)<>64
    THROW 51928,''CHART_MAC_KEY_UNAVAILABLE'',1;
   DECLARE @bytes varbinary(max)=CONVERT(varbinary(max),@message);
   DECLARE @calculated varbinary(32)=HASHBYTES(''SHA2_256'',
     CONVERT(varbinary(max),@opad)+HASHBYTES(''SHA2_256'',
       CONVERT(varbinary(max),@ipad)+@bytes));
   IF @calculated IS NULL OR @calculated<>@Signature
    THROW 51928,''CHART_MAC_SIGNATURE_INVALID'',1;
   IF EXISTS(SELECT 1 FROM uqp.ChartIssuerProofNonceDisposable WITH(UPDLOCK,HOLDLOCK)
     WHERE Nonce=@Nonce)
    THROW 51928,''CHART_MAC_NONCE_REPLAY'',1;
   INSERT uqp.ChartIssuerProofNonceDisposable(Nonce,ActorId,ConsumedAtUtc)
     VALUES(@Nonce,@ActorId,@now);
   COMMIT;
  END TRY
  BEGIN CATCH
   IF XACT_STATE()<>0 ROLLBACK;
   THROW;
  END CATCH
 END');
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::uqp.ChartIssuerMacPadsDisposable
 TO [UQP_Chart_IssuerSynthetic];
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::uqp.ChartIssuerMacPadsDisposable
 TO [UQP_Chart_Writer];
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::uqp.ChartIssuerProofNonceDisposable
 TO [UQP_Chart_IssuerSynthetic];
DENY SELECT,INSERT,UPDATE,DELETE ON OBJECT::uqp.ChartIssuerProofNonceDisposable
 TO [UQP_Chart_Writer];
GRANT EXECUTE ON OBJECT::uqp.usp_ChartIssuerMacVerify_IsolatedDraft
 TO [UQP_Chart_IssuerSynthetic];
DENY EXECUTE ON OBJECT::uqp.usp_ChartIssuerMacVerify_IsolatedDraft
 TO [UQP_Chart_Writer];`;
  await db.request().batch(ddl);
  await db.request()
    .input("ip",sql.VarBinary(64),ip)
    .input("op",sql.VarBinary(64),op)
    .query("INSERT uqp.ChartIssuerMacPadsDisposable(KeyId,InnerPad,OuterPad) VALUES(1,@ip,@op)");
  const rights=(await db.request().query(
    "EXECUTE AS USER=N'UQP_Chart_IssuerSynthetic';" +
    "SELECT HAS_PERMS_BY_NAME(N'uqp.usp_ChartIssuerMacVerify_IsolatedDraft',N'OBJECT',N'EXECUTE') AS CanVerify," +
    "HAS_PERMS_BY_NAME(N'uqp.ChartIssuerMacPadsDisposable',N'OBJECT',N'SELECT') AS CanReadKey;" +
    "REVERT;" +
    "EXECUTE AS USER=N'UQP_Chart_Writer';" +
    "SELECT HAS_PERMS_BY_NAME(N'uqp.usp_ChartIssuerMacVerify_IsolatedDraft',N'OBJECT',N'EXECUTE') AS CanVerify," +
    "HAS_PERMS_BY_NAME(N'uqp.ChartIssuerMacPadsDisposable',N'OBJECT',N'SELECT') AS CanReadKey;" +
    "REVERT"
  )).recordsets;
  const sets=Object.values(rights);
  assert.equal(Number(sets[0]?.[0]?.CanVerify),1);
  assert.equal(Number(sets[0]?.[0]?.CanReadKey),0);
  assert.equal(Number(sets[1]?.[0]?.CanVerify),0);
  assert.equal(Number(sets[1]?.[0]?.CanReadKey),0);
  const now=Date.now();
  const proof:ProofScope={
    actor:8,token:1,dashboard:7,profile:22,
    requestId:"00000000-0000-4000-8000-000000009001",
    source:"PRIMARY",digest:"a".repeat(64),
    x:10,y:10,width:600,height:360,nonce:randomUUID(),
    issuedAt:new Date(now-1000),expiresAt:new Date(now+9000),
  };
  const mac=(p:ProofScope)=>createHmac("sha256",key).update(canon(p),"utf8").digest();
  const run=(p:ProofScope,signature=mac(p),who="UQP_Chart_IssuerSynthetic")=>
    db.request()
    .input("actor",sql.BigInt,p.actor)
    .input("token",sql.Int,p.token)
    .input("dashboard",sql.BigInt,p.dashboard)
    .input("profile",sql.BigInt,p.profile)
    .input("request",sql.UniqueIdentifier,p.requestId)
    .input("source",sql.VarChar(64),p.source)
    .input("digest",sql.Char(64),p.digest)
    .input("x",sql.Int,p.x).input("y",sql.Int,p.y)
    .input("width",sql.Int,p.width).input("height",sql.Int,p.height)
    .input("nonce",sql.UniqueIdentifier,p.nonce)
    .input("issued",sql.DateTime2(3),p.issuedAt)
    .input("expires",sql.DateTime2(3),p.expiresAt)
    .input("signature",sql.VarBinary(sql.MAX),signature)
    .query(
      "EXECUTE AS USER=N'"+who+"';"+
      "BEGIN TRY EXEC uqp.usp_ChartIssuerMacVerify_IsolatedDraft "+
      "@ActorId=@actor,@TokenVersion=@token,@DashboardId=@dashboard,@ProfileId=@profile,"+
      "@RequestId=@request,@SourceKey=@source,@ConfigSha256=@digest,"+
      "@X=@x,@Y=@y,@Width=@width,@Height=@height,@Nonce=@nonce,"+
      "@IssuedAtUtc=@issued,@ExpiresAtUtc=@expires,@Signature=@signature;"+
      "END TRY BEGIN CATCH REVERT; THROW; END CATCH; REVERT;"
    );
  const clean=async()=>Number((await db.request()
    .query("SELECT COUNT_BIG(*) AS Total FROM uqp.ChartIssuerProofNonceDisposable")
  ).recordset[0]?.Total);
  assert.equal(await clean(),0);
  const signature=mac(proof);
  assert.equal(signature.length,32);
  // A correctly signed Actor 8 must not be reusable to represent Actor 77,
  // a different request, token, dashboard, digest, geometry or nonce.
  for(const change of [
    {actor:77},{token:2},{dashboard:8},{profile:23},
    {requestId:"00000000-0000-4000-8000-000000009002"},
    {digest:"b".repeat(64)},{source:"OTHER"},{x:11},{height:359},
    {nonce:randomUUID()},{expiresAt:new Date(now+8500)},
  ]){
    await assert.rejects(run({...proof,...change},signature),forbidden);
    assert.equal(await clean(),0);
  }
  await assert.rejects(run(proof,Buffer.alloc(32)),forbidden);
  await assert.rejects(run(proof,signature,"UQP_Chart_Writer"),(e:unknown)=>
    e instanceof Error); // permission denied by SQL, not a successful verification
  assert.equal(await clean(),0);
  const stale={...proof,issuedAt:new Date(now-30000),expiresAt:new Date(now-20000)};
  await assert.rejects(run(stale),forbidden);
  assert.equal(await clean(),0);
  await run(proof,signature);
  assert.equal(await clean(),1);
  await assert.rejects(run(proof,signature),forbidden);
  assert.equal(await clean(),1);
  console.log("CHART_2B15D14_DISPOSABLE_HMAC_SHA256_SCOPE_EXPIRY_REPLAY_PASS");
  console.log("CHART_2B15D14_TRUSTED_HTTP_ISSUER_BINDING_STILL_RELEASE_BLOCKED");
  // 2B-15D-15: the synthetic Issuer must not directly call the old
  // caller-controlled @ActorId procedure. A single SQL transaction now
  // verifies the HMAC and uses the nonce before inserting its Grant.
  const signedScript=await readFile(new URL(
    "../../../database/drafts/928_chart_signed_issuer_atomic_disposable.sql.draft",
    import.meta.url),"utf8");
  await db.request().batch(signedScript);
  const rightsSigned=async(who:"UQP_Chart_IssuerSynthetic"|"UQP_Chart_Writer"|
      "UQP_Chart_ConsumerSynthetic")=>(await db.request().query(
        "EXECUTE AS USER=N'"+who+"';"+
        "SELECT HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssue_IsolatedDraft',"+
        "N'OBJECT',N'EXECUTE') AS Legacy,"+
        "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssueSigned_IsolatedDraft',"+
        "N'OBJECT',N'EXECUTE') AS Signed,"+
        "HAS_PERMS_BY_NAME(N'uqp.ChartIssuerMacPadsDisposable',"+
        "N'OBJECT',N'SELECT') AS KeyRead;REVERT;"
      )).recordset[0];
  const issuerRights=await rightsSigned("UQP_Chart_IssuerSynthetic");
  const writerRights=await rightsSigned("UQP_Chart_Writer");
  const consumerRights=await rightsSigned("UQP_Chart_ConsumerSynthetic");
  assert.equal(Number(issuerRights?.Legacy),0);
  assert.equal(Number(issuerRights?.Signed),1);
  assert.equal(Number(issuerRights?.KeyRead),0);
  assert.equal(Number(writerRights?.Signed),0);
  assert.equal(Number(writerRights?.KeyRead),0);
  assert.equal(Number(consumerRights?.Signed),0);
  const signed={
    ...proof,requestId:"00000000-0000-4000-8000-000000009003",
    nonce:randomUUID(),issuedAt:new Date(Date.now()-1000),
    expiresAt:new Date(Date.now()+8500),
  };
  const countSigned=async()=>{
    const row=(await db.request().query(
      "SELECT (SELECT COUNT_BIG(*) FROM uqp.ChartIssuerProofNonceDisposable) AS Nonces,"+
      "(SELECT COUNT_BIG(*) FROM uqp.ChartActorDelegationDisposable) AS Grants"
    )).recordset[0];
    return [Number(row?.Nonces),Number(row?.Grants)];
  };
  const issueSigned=(p:ProofScope,signature=mac(p),
      who:"UQP_Chart_IssuerSynthetic"|"UQP_Chart_Writer"="UQP_Chart_IssuerSynthetic")=>
    db.request()
    .input("actor",sql.BigInt,p.actor)
    .input("token",sql.Int,p.token)
    .input("dashboard",sql.BigInt,p.dashboard)
    .input("profile",sql.BigInt,p.profile)
    .input("request",sql.UniqueIdentifier,p.requestId)
    .input("source",sql.VarChar(64),p.source)
    .input("digest",sql.Char(64),p.digest)
    .input("x",sql.Int,p.x).input("y",sql.Int,p.y)
    .input("width",sql.Int,p.width).input("height",sql.Int,p.height)
    .input("nonce",sql.UniqueIdentifier,p.nonce)
    .input("issued",sql.DateTime2(3),p.issuedAt)
    .input("expires",sql.DateTime2(3),p.expiresAt)
    .input("signature",sql.VarBinary(sql.MAX),signature)
    .query("DECLARE @grant UNIQUEIDENTIFIER,@secret VARBINARY(32);"+
      "EXECUTE AS USER=N'"+who+"';"+
      "BEGIN TRY EXEC uqp.usp_ChartDelegationIssueSigned_IsolatedDraft "+
      "@ActorId=@actor,@TokenVersion=@token,@DashboardId=@dashboard,"+
      "@ProfileId=@profile,@RequestId=@request,@SourceKey=@source,"+
      "@ConfigSha256=@digest,@X=@x,@Y=@y,@Width=@width,@Height=@height,"+
      "@Nonce=@nonce,@IssuedAtUtc=@issued,@ExpiresAtUtc=@expires,"+
      "@Signature=@signature,@GrantId=@grant OUTPUT,@Secret=@secret OUTPUT;"+
      "END TRY BEGIN CATCH REVERT; THROW; END CATCH;REVERT;"+
      "SELECT @grant AS GrantId,@secret AS Secret;");
  const beforeSigned=await countSigned();
  for(const mutation of [
    {actor:77},{token:2},{dashboard:8},{profile:23},
    {requestId:"00000000-0000-4000-8000-000000009004"},
    {source:"OTHER"},{digest:"b".repeat(64)},
    {x:11},{y:12},{width:601},{height:361},{nonce:randomUUID()},
  ]){
    await assert.rejects(issueSigned({...signed,...mutation},mac(signed)),forbidden);
    assert.deepEqual(await countSigned(),beforeSigned);
  }
  await assert.rejects(issueSigned(signed,Buffer.alloc(32,0)),forbidden);
  await assert.rejects(issueSigned(signed,mac(signed),"UQP_Chart_Writer"),
    (e:unknown)=>e instanceof Error);
  assert.deepEqual(await countSigned(),beforeSigned);
  // Valid HMAC is NOT enough if the live Actor is revoked or token changed.
  await db.request().query("UPDATE uqp.AppUser SET IsActive=0 WHERE Id=8");
  try {
    await assert.rejects(issueSigned(signed),forbidden);
  } finally {
    await db.request().query("UPDATE uqp.AppUser SET IsActive=1 WHERE Id=8");
  }
  const invalidToken={...signed,token:2};
  await assert.rejects(issueSigned(invalidToken),forbidden);
  assert.deepEqual(await countSigned(),beforeSigned);
  const issued=(await issueSigned(signed)).recordset[0];
  assert.match(String(issued?.GrantId),/^[a-f0-9-]{36}$/i);
  assert(Buffer.isBuffer(issued?.Secret));
  assert.equal(issued.Secret.length,32);
  assert.deepEqual(await countSigned(),beforeSigned.map(v=>v+1));
  const saved=(await db.request()
    .input("id",sql.UniqueIdentifier,issued.GrantId)
    .input("nonce",sql.UniqueIdentifier,signed.nonce)
    .query("SELECT g.ActorId,g.TokenVersion,g.DashboardId,g.ProfileId,"+
      "g.RequestId,g.SourceKey,g.ConfigSha256,g.SecretSha256,"+
      "n.ActorId AS NonceActor FROM uqp.ChartActorDelegationDisposable g "+
      "JOIN uqp.ChartIssuerProofNonceDisposable n ON n.Nonce=@nonce "+
      "WHERE g.GrantId=@id")
  ).recordset[0];
  assert.equal(Number(saved?.ActorId),8);
  assert.equal(Number(saved?.TokenVersion),1);
  assert.equal(Number(saved?.DashboardId),7);
  assert.equal(Number(saved?.ProfileId),22);
  assert.equal(saved?.RequestId,signed.requestId);
  assert.equal(saved?.SourceKey,"PRIMARY");
  assert.equal(saved?.ConfigSha256,signed.digest);
  assert.equal(Number(saved?.NonceActor),8);
  assert(Buffer.isBuffer(saved?.SecretSha256));
  assert.equal(Buffer.compare(saved.SecretSha256,
    createHash("sha256").update(issued.Secret).digest()),0);
  await assert.rejects(issueSigned(signed),forbidden);
  assert.deepEqual(await countSigned(),beforeSigned.map(v=>v+1));
  // A valid HMAC and fresh Nonce paired with a duplicated RequestId must
  // roll back both the Nonce insert and Grant insert atomically.
  const conflict={...signed,nonce:randomUUID(),
    issuedAt:new Date(Date.now()-500),expiresAt:new Date(Date.now()+8500)};
  await assert.rejects(issueSigned(conflict),(e:unknown)=>
    e instanceof Error && [2601,2627].includes(Number((e as {number?:unknown}).number)));
  assert.deepEqual(await countSigned(),beforeSigned.map(v=>v+1));
  console.log("CHART_2B15D15_DISPOSABLE_SIGNED_ISSUER_GRANT_NONCE_ATOMIC_PASS");
  console.log("CHART_2B15D15_HTTP_SIGNER_TRUST_NOT_RELEASE_APPROVED");

  // 2B-15D-16: synthetic loopback HTTP -> verified JWT WeakMap actor ->
  // test-local HMAC signer -> isolated SQL Issuer. This proves the mapping
  // in the disposable CI fixture, NOT a physically independent signer.
  // No production router imports this file. Never return the SQL secret.
  const previousJwtSecret=env.JWT_SECRET;
  env.JWT_SECRET="chart-http-synthetic-"+randomBytes(24).toString("hex");
  let actor8Session={
    isActive:true,tokenVersion:1,permissions:["DESIGN_QUERY"],
  };
  const app=express();
  app.use(express.json({limit:"12kb"}));
  app.use(createAuthenticateJwt(async(userId:number)=>{
    if(userId===8)return actor8Session;
    if(userId===77)return {
      isActive:true,tokenVersion:1,permissions:["DESIGN_QUERY"],
    };
    return null;
  }));
  const httpPath="/synthetic-chart-signed-issuer";
  app.post(httpPath,async(req,res)=>{
    // Only a verified JWT + live server-side session can create the intent.
    // The client cannot supply or replace ActorId, approval, nonce or key.
    const intent=deriveDormantChartIssuerIntent(req,7,req.body);
    if(!intent){res.status(403).json({code:"DENIED"});return;}
    const now=Date.now();
    const scoped:ProofScope={
      actor:intent.ActorId,token:intent.TokenVersion,
      dashboard:intent.DashboardId,profile:intent.ProfileId,
      requestId:intent.RequestId,source:intent.SourceKey,
      digest:intent.ConfigSha256,
      x:intent.X,y:intent.Y,width:intent.Width,height:intent.Height,
      nonce:randomUUID(),issuedAt:new Date(now-1000),
      expiresAt:new Date(now+8000),
    };
    // This callback deliberately owns the test-only HMAC key, while SQL
    // independently revalidates the signed scope, nonce, RBAC and profile.
    const signature=mac(scoped);
    try{
      const issuedGrant=(await issueSigned(scoped,signature)).recordset[0];
      if(!issuedGrant?.GrantId||!Buffer.isBuffer(issuedGrant.Secret))
        throw Error("SYNTHETIC_ISSUER_RESULT_DENIED");
      res.status(200).json({accepted:true});
    }catch{
      // No SQL error detail, GrantId, secret or signed capability to caller.
      res.status(403).json({code:"DENIED"});
    }
  });
  const loopback=createServer(app);
  try{
    await new Promise<void>(resolve=>loopback.listen(0,"127.0.0.1",resolve));
    const address=loopback.address();
    assert(address&&typeof address!=="string");
    const root="http://127.0.0.1:"+address.port+httpPath;
    const createToken=(actor:number,version=1)=>jwt.sign({
      sub:String(actor),tokenVersion:version,username:"synthetic",
      permissions:[],
    },env.JWT_SECRET);
    const jwt8=createToken(8);
    const jwt77=createToken(77);
    const body={
      profileId:22,requestId:randomUUID(),
      config:{
        version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
        categoryColumn:"ROOM",valueColumn:"TOTAL",
        valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true,
      },
      placement:{x:10,y:10,width:600,height:360},
    };
    const send=(payload:unknown,token=jwt8)=>fetch(root,{
      method:"POST",headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+token,
      },
      body:JSON.stringify(payload),
    });
    const beforeHttp=await countSigned();
    const invalidJwt=jwt.sign({sub:"8",tokenVersion:1},"wrong-test-key");
    assert.equal((await send(body,invalidJwt)).status,401);
    assert.equal((await send(body,createToken(8,2))).status,401);
    for(const forged of [
      {actorId:77},{ActorId:77},{tokenVersion:5},
      {grantId:randomUUID()},{issuerSid:"fake"},{secret:"fake"},
      {signature:"fake"},{nonce:randomUUID()},{approved:true},
    ])assert.equal((await send({...body,...forged})).status,403);
    actor8Session={...actor8Session,permissions:[]};
    assert.equal((await send(body)).status,403);
    actor8Session={...actor8Session,permissions:["DESIGN_QUERY"],isActive:false};
    assert.equal((await send(body)).status,401);
    actor8Session={...actor8Session,isActive:true,tokenVersion:2};
    assert.equal((await send(body)).status,401);
    actor8Session={...actor8Session,tokenVersion:1};
    assert.deepEqual(await countSigned(),beforeHttp);
    // Even if HTTP mock session is active, SQL's current User state is
    // independently authoritative before nonce/grant insertion.
    await db.request().query("UPDATE uqp.AppUser SET IsActive=0 WHERE Id=8");
    try{
      assert.equal((await send(body)).status,403);
    }finally{
      await db.request().query("UPDATE uqp.AppUser SET IsActive=1 WHERE Id=8");
    }
    assert.deepEqual(await countSigned(),beforeHttp);
    const result=await send(body);
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{accepted:true});
    assert.deepEqual(await countSigned(),beforeHttp.map(v=>v+1));
    const attribution=(await db.request()
      .input("requestId",sql.UniqueIdentifier,body.requestId)
      .query("SELECT ActorId,TokenVersion,DashboardId,ProfileId,"+
        "SourceKey,ConfigSha256 FROM uqp.ChartActorDelegationDisposable "+
        "WHERE RequestId=@requestId")).recordset;
    assert.equal(attribution.length,1);
    assert.equal(Number(attribution[0]?.ActorId),8);
    assert.equal(Number(attribution[0]?.TokenVersion),1);
    assert.equal(Number(attribution[0]?.DashboardId),7);
    assert.equal(Number(attribution[0]?.ProfileId),22);
    assert.equal(attribution[0]?.SourceKey,"PRIMARY");
    assert.match(String(attribution[0]?.ConfigSha256),/^[a-f0-9]{64}$/);
    // A fresh nonce cannot make the same requestId issue a second grant.
    assert.equal((await send(body)).status,403);
    assert.deepEqual(await countSigned(),beforeHttp.map(v=>v+1));
    // Actor 77 has actual SQL DESIGN_QUERY (fixture). A JWT for 77 may
    // issue its own scope, not be obtained by mutating Actor 8's body.
    const body77={...body,requestId:randomUUID()};
    const response77=await send(body77,jwt77);
    assert.equal(response77.status,200);
    assert.deepEqual(await response77.json(),{accepted:true});
    const actor77Row=(await db.request()
      .input("requestId",sql.UniqueIdentifier,body77.requestId)
      .query("SELECT ActorId FROM uqp.ChartActorDelegationDisposable "+
        "WHERE RequestId=@requestId")).recordset[0];
    assert.equal(Number(actor77Row?.ActorId),77);
    assert.deepEqual(await countSigned(),beforeHttp.map(v=>v+2));
    console.log("CHART_2B15D16_DISPOSABLE_VERIFIED_HTTP_JWT_ACTOR_TO_SIGNED_SQL_ISSUER_PASS");
  }finally{
    env.JWT_SECRET=previousJwtSecret;
    if(loopback.listening)
      await new Promise<void>(resolve=>loopback.close(()=>resolve()));
  }
  console.log("CHART_2B15D16_INDEPENDENT_SIGNER_AND_PRODUCTION_BINDING_STILL_BLOCKED");


}
