// 2B-15D-14: ephemeral SQL Server 2019/2022 cryptographic proof fixture.
// NOT a production signer, trusted JWT/HTTP Actor bridge, migration or grant.
// Purpose: prove SQL can verify a short-lived, fully scoped HMAC-SHA256
// issued by an independently controlled signer and reject tampering/replay.
// The same test deliberately leaves the existing synthetic Issuer unsafe.
import assert from "node:assert/strict";
import {createHmac,randomBytes,randomUUID} from "node:crypto";
import sql from "mssql";

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
  for(let i=0;i<key.length;i++){ip[i]^=key[i]!;op[i]^=key[i]!;}
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
}
