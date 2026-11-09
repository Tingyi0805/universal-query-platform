// 2B-15D-17: real SQL-auth LOGIN isolation in disposable SQL 2019/2022.
// Creates temporary SQL logins ONLY in the isolated CI Docker instance and
// a throwaway UQP_CH_<12hex> database. NEVER production provisioning code.
// A test-only Node signer still has the key: this does not approve production.
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import sql from "mssql";

export type SqlLoginSignedScope=Readonly<{
 actor:number;token:number;dashboard:number;profile:number;
 requestId:string;source:string;digest:string;
 x:number;y:number;width:number;height:number;
 nonce:string;issuedAt:Date;expiresAt:Date;
}>;
type Role="platform"|"issuer"|"writer";
const roles=["platform","issuer","writer"] as const;
const sqlName=(name:string)=>"["+name+"]";
const escapeString=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const isDenied=(error:unknown)=>error instanceof Error &&
  [229,230,51928].includes(Number((error as {number?:unknown}).number));
const h64=(b:Buffer)=>b.toString("hex").toUpperCase();

export async function verifyChartSqlLoginIsolationDisposable(
 admin:sql.ConnectionPool,db:sql.ConnectionPool,config:sql.config,
 machine:string,initial:SqlLoginSignedScope,
 sign:(scope:SqlLoginSignedScope)=>Buffer,
):Promise<void>{
 if(process.env.UQP_D1_SCOPE!=="DISPOSABLE_ONLY" ||
    process.env.UQP_D1_CONTAINER_NAME!==machine ||
    !/^uqp-d1-[a-f0-9]{12}$/.test(machine) ||
    config.server!=="127.0.0.1"||config.port!==14336 ||
    Object.keys(process.env).some(k=>k.startsWith("PLATFORM_DB_") ||
      k==="DOTENV_CONFIG_PATH"))
   throw Error("CHART_SQL_LOGINS_DISPOSABLE_ONLY");
 const master=(await admin.request().query(
  "SELECT DB_NAME() AS Db,CONVERT(nvarchar(128),"+
  "SERVERPROPERTY('MachineName')) AS Machine"
 )).recordset[0];
 const target=(await db.request().query(
  "SELECT DB_NAME() AS Db,CONVERT(nvarchar(128),"+
  "SERVERPROPERTY('MachineName')) AS Machine"
 )).recordset[0];
 if(master?.Db!=="master"||master.Machine!==machine||
    typeof target?.Db!=="string"||
    !/^UQP_CH_[a-f0-9]{12}$/.test(target.Db)||
    target.Machine!==machine)
   throw Error("CHART_SQL_LOGIN_TARGET_FORBIDDEN");

 const suffix=randomBytes(6).toString("hex");
 const identities=Object.fromEntries(roles.map(role=>[
   role,{name:"UQPC17_"+suffix+"_"+role.toUpperCase(),
      password:"T17!"+randomBytes(24).toString("hex")+"aZ"},
 ])) as Record<Role,{name:string;password:string}>;
 const pools:Partial<Record<Role,sql.ConnectionPool>>={};
 const createdLogins:Role[]=[],createdUsers:Role[]=[];
 const sqlCall=(scope:SqlLoginSignedScope,signature:Buffer,pool:sql.ConnectionPool)=>
  pool.request()
   .input("actor",sql.BigInt,scope.actor)
   .input("token",sql.Int,scope.token)
   .input("dashboard",sql.BigInt,scope.dashboard)
   .input("profile",sql.BigInt,scope.profile)
   .input("request",sql.UniqueIdentifier,scope.requestId)
   .input("source",sql.VarChar(64),scope.source)
   .input("digest",sql.Char(64),scope.digest)
   .input("x",sql.Int,scope.x).input("y",sql.Int,scope.y)
   .input("width",sql.Int,scope.width)
   .input("height",sql.Int,scope.height)
   .input("nonce",sql.UniqueIdentifier,scope.nonce)
   .input("issued",sql.DateTime2(3),scope.issuedAt)
   .input("expires",sql.DateTime2(3),scope.expiresAt)
   .input("signature",sql.VarBinary(sql.MAX),signature)
   .query(
     "DECLARE @grant UNIQUEIDENTIFIER,@secret VARBINARY(32);"+
     "EXEC uqp.usp_ChartDelegationIssueSigned_IsolatedDraft "+
     "@ActorId=@actor,@TokenVersion=@token,@DashboardId=@dashboard,"+
     "@ProfileId=@profile,@RequestId=@request,@SourceKey=@source,"+
     "@ConfigSha256=@digest,@X=@x,@Y=@y,@Width=@width,@Height=@height,"+
     "@Nonce=@nonce,@IssuedAtUtc=@issued,@ExpiresAtUtc=@expires,"+
     "@Signature=@signature,@GrantId=@grant OUTPUT,@Secret=@secret OUTPUT;"+
     "SELECT @grant AS GrantId,@secret AS Secret;");
 try {
  // DDL here is performed by the synthetic disposable SA test harness.
  // Each real SQL connection uses its own generated password and ORIGINAL_LOGIN.
  for(const role of roles){
   const identity=identities[role];
   await admin.request().query(
      "CREATE LOGIN "+sqlName(identity.name)+" WITH PASSWORD="+
      escapeString(identity.password)+",CHECK_POLICY=OFF,CHECK_EXPIRATION=OFF");
   createdLogins.push(role);
   await db.request().query("CREATE USER "+sqlName(identity.name)+
      " FOR LOGIN "+sqlName(identity.name));
   createdUsers.push(role);
  }
  const issuer=identities.issuer.name;
  const writer=identities.writer.name;
  await db.request().query(
    "GRANT EXECUTE ON OBJECT::uqp.usp_ChartDelegationIssueSigned_IsolatedDraft TO "+
      sqlName(issuer)+";"+
    "DENY EXECUTE ON OBJECT::uqp.usp_ChartDelegationIssue_IsolatedDraft TO "+
      sqlName(issuer)+";"+
    "GRANT EXECUTE ON OBJECT::uqp.usp_ChartCreateWithDelegation_IsolatedDraft TO "+
      sqlName(writer));
  for(const role of roles){
   const item=identities[role];
   pools[role]=await new sql.ConnectionPool({
     ...config,user:item.name,password:item.password,database:target.Db,
     pool:{max:1,min:0},
   }).connect();
  }
  const metadata=await Promise.all(roles.map(async(role)=>{
    const result=await pools[role]!.request().query(
      "SELECT ORIGINAL_LOGIN() AS LoginName,"+
      "CONVERT(varchar(256),SUSER_SID(ORIGINAL_LOGIN()),2) AS OriginalSid,"+
      "DB_NAME() AS DbName,USER_NAME() AS DatabasePrincipal,"+
      "IS_SRVROLEMEMBER(N'sysadmin') AS Sysadmin,"+
      "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssueSigned_IsolatedDraft',"+
      "N'OBJECT',N'EXECUTE') AS SignedExecute,"+
      "HAS_PERMS_BY_NAME(N'uqp.usp_ChartDelegationIssue_IsolatedDraft',"+
      "N'OBJECT',N'EXECUTE') AS LegacyExecute,"+
      "HAS_PERMS_BY_NAME(N'uqp.ChartIssuerMacPadsDisposable',"+
      "N'OBJECT',N'SELECT') AS PadsRead,"+
      "HAS_PERMS_BY_NAME(N'uqp.ChartActorDelegationDisposable',"+
      "N'OBJECT',N'INSERT') AS GrantInsert,"+
      "HAS_PERMS_BY_NAME(N'uqp.usp_ChartCreateWithDelegation_IsolatedDraft',"+
      "N'OBJECT',N'EXECUTE') AS WriterExecute,"+
      "HAS_PERMS_BY_NAME(N'uqp.DashboardWidget',"+
      "N'OBJECT',N'INSERT') AS DirectWidgetInsert");
    return result.recordset[0];
  }));
  assert.equal(new Set(metadata.map(r=>r?.OriginalSid)).size,3);
  for(let i=0;i<roles.length;i++){
    const role=roles[i]!;
    const row=metadata[i];
    assert.equal(row?.LoginName,identities[role].name);
    assert.equal(row?.DatabasePrincipal,identities[role].name);
    assert.equal(row?.DbName,target.Db);
    assert.match(String(row?.OriginalSid),/^[0-9A-F]+$/);
    assert.equal(Number(row?.Sysadmin),0);
    assert.notEqual(Number(row?.PadsRead),1);
    assert.notEqual(Number(row?.GrantInsert),1);
    assert.notEqual(Number(row?.LegacyExecute),1);
    assert.equal(Number(row?.SignedExecute),role==="issuer"?1:0);
    assert.equal(Number(row?.WriterExecute),role==="writer"?1:0);
    assert.notEqual(Number(row?.DirectWidgetInsert),1);
  }
  for(const role of ["platform","writer"] as const){
    await assert.rejects(
      sqlCall(initial,sign(initial),pools[role]!),isDenied);
  }
  await assert.rejects(
    pools.issuer!.request().query(
      "SELECT TOP(1) InnerPad FROM uqp.ChartIssuerMacPadsDisposable"),isDenied);
  await assert.rejects(
    pools.issuer!.request().query(
      "EXEC uqp.usp_ChartDelegationIssue_IsolatedDraft"),isDenied);
  // SQL issuer's executable procedure checks the signature, not merely
  // the login identity. An invalid signature cannot add Nonce or Grant.
  const scope={...initial,requestId:randomUUID(),nonce:randomUUID(),
     issuedAt:new Date(Date.now()-800),expiresAt:new Date(Date.now()+8500)};
  const before=(await db.request().query(
    "SELECT (SELECT COUNT_BIG(*) FROM uqp.ChartActorDelegationDisposable) AS Grants,"+
    "(SELECT COUNT_BIG(*) FROM uqp.ChartIssuerProofNonceDisposable) AS Nonces"
  )).recordset[0];
  await assert.rejects(
     sqlCall(scope,Buffer.alloc(32),pools.issuer!),isDenied);
  const interim=(await db.request().query(
    "SELECT (SELECT COUNT_BIG(*) FROM uqp.ChartActorDelegationDisposable) AS Grants,"+
    "(SELECT COUNT_BIG(*) FROM uqp.ChartIssuerProofNonceDisposable) AS Nonces"
  )).recordset[0];
  assert.deepEqual(interim,before);
  const signed=(await sqlCall(scope,sign(scope),pools.issuer!)).recordset[0];
  assert.match(String(signed?.GrantId),/^[a-f0-9-]{36}$/i);
  assert(Buffer.isBuffer(signed?.Secret));
  assert.equal(signed.Secret.length,32);
  const row=(await db.request()
    .input("id",sql.UniqueIdentifier,signed.GrantId)
    .query("SELECT ActorId,TokenVersion,IssuerSid,SecretSha256 "+
      "FROM uqp.ChartActorDelegationDisposable WHERE GrantId=@id")
  ).recordset[0];
  assert.equal(Number(row?.ActorId),scope.actor);
  assert.equal(Number(row?.TokenVersion),scope.token);
  assert(Buffer.isBuffer(row?.SecretSha256));
  assert.equal(Buffer.compare(row.SecretSha256,
    createHash("sha256").update(signed.Secret).digest()),0);
  const sqlSid=h64(row.IssuerSid as Buffer);
  assert.equal(sqlSid,metadata[1]?.OriginalSid);
  await assert.rejects(sqlCall(scope,sign(scope),pools.issuer!),isDenied);
  const final=(await db.request().query(
    "SELECT (SELECT COUNT_BIG(*) FROM uqp.ChartActorDelegationDisposable) AS Grants,"+
    "(SELECT COUNT_BIG(*) FROM uqp.ChartIssuerProofNonceDisposable) AS Nonces"
  )).recordset[0];
  assert.equal(Number(final?.Grants),Number(before?.Grants)+1);
  assert.equal(Number(final?.Nonces),Number(before?.Nonces)+1);

  // Issue #89: real SQL-auth logins must complete an actual independent
  // Issuer -> Writer transaction, not merely prove IssuerSid metadata.
  // Only the dedicated writer login may consume a signed one-time grant.
  const chartJson=JSON.stringify({
    version:1,chartType:"BAR",dataSourceKey:"PRIMARY",
    categoryColumn:"ROOM",valueColumn:"TOTAL",
    valueMode:"QUERY_RESULT",maxPoints:20,showLegend:true,
  });
  const chartScope={
    ...initial,requestId:randomUUID(),nonce:randomUUID(),
    digest:createHash("sha256").update(chartJson,"utf8").digest("hex"),
    issuedAt:new Date(Date.now()-800),expiresAt:new Date(Date.now()+8500),
  };
  const realGrant=(await sqlCall(chartScope,sign(chartScope),pools.issuer!))
    .recordset[0];
  assert.match(String(realGrant?.GrantId),/^[a-f0-9-]{36}$/i);
  assert(Buffer.isBuffer(realGrant?.Secret));
  assert.equal(realGrant.Secret.length,32);
  const issuerGrant=(await db.request()
    .input("grant",sql.UniqueIdentifier,realGrant.GrantId)
    .query("SELECT IssuerSid,ActorId,TokenVersion,ConsumedAtUtc "+
      "FROM uqp.ChartActorDelegationDisposable WHERE GrantId=@grant")
  ).recordset[0];
  assert.equal(h64(issuerGrant.IssuerSid as Buffer),metadata[1]?.OriginalSid);
  assert.equal(Number(issuerGrant.ActorId),chartScope.actor);
  assert.equal(Number(issuerGrant.TokenVersion),chartScope.token);
  assert.equal(issuerGrant.ConsumedAtUtc,null);
  const runWriter=(pool:sql.ConnectionPool,changes:Readonly<{
    actor?:number;token?:number;secret?:Buffer;config?:string;
  }>={})=>pool.request()
    .input("grant",sql.UniqueIdentifier,realGrant.GrantId)
    .input("secret",sql.VarBinary(sql.MAX),changes.secret??realGrant.Secret)
    .input("actor",sql.BigInt,changes.actor??chartScope.actor)
    .input("token",sql.Int,changes.token??chartScope.token)
    .input("dashboard",sql.BigInt,chartScope.dashboard)
    .input("profile",sql.BigInt,chartScope.profile)
    .input("request",sql.UniqueIdentifier,chartScope.requestId)
    .input("source",sql.NVarChar(64),chartScope.source)
    .input("config",sql.NVarChar(sql.MAX),changes.config??chartJson)
    .input("x",sql.Int,chartScope.x).input("y",sql.Int,chartScope.y)
    .input("width",sql.Int,chartScope.width)
    .input("height",sql.Int,chartScope.height)
    .query("EXEC uqp.usp_ChartCreateWithDelegation_IsolatedDraft "+
      "@DashboardId=@dashboard,@ProfileId=@profile,"+
      "@ActorId=@actor,@TokenVersion=@token,"+
      "@RequestId=@request,@GrantId=@grant,@Secret=@secret,"+
      "@SourceKey=@source,@ConfigJson=@config,"+
      "@X=@x,@Y=@y,@Width=@width,@Height=@height;");
  const counts=async()=> {
    const row=(await db.request().query(
      "SELECT (SELECT COUNT_BIG(*) FROM uqp.DashboardChartTrustRequest) AS Ledger,"+
      "(SELECT COUNT_BIG(*) FROM uqp.AuditLog) AS Audit,"+
      "(SELECT COUNT_BIG(*) FROM uqp.DashboardWidget WHERE WidgetType=N'CHART') AS Widgets,"+
      "(SELECT COUNT_BIG(*) FROM uqp.DashboardChartWidgetSeal) AS Seals,"+
      "(SELECT COUNT_BIG(*) FROM uqp.ChartActorDelegationDisposable WHERE ConsumedAtUtc IS NOT NULL) AS Consumed"
    )).recordset[0];
    return ["Ledger","Audit","Widgets","Seals","Consumed"]
      .map(name=>Number(row?.[name]));
  };
  const beforeWriter=await counts();
  for(const disallowed of [pools.platform!,pools.issuer!])
    await assert.rejects(runWriter(disallowed),isDenied);
  await assert.rejects(runWriter(pools.writer!,{actor:77}),isDenied);
  await assert.rejects(runWriter(pools.writer!,{token:chartScope.token+1}),isDenied);
  await assert.rejects(runWriter(pools.writer!,{secret:Buffer.alloc(32)}),isDenied);
  await assert.rejects(runWriter(pools.writer!,{
    config:JSON.stringify({...JSON.parse(chartJson),maxPoints:21}),
  }),isDenied);
  assert.deepEqual(await counts(),beforeWriter);
  // A signed grant is not sufficient when the DB user is later revoked.
  await db.request().input("actor",sql.BigInt,chartScope.actor)
    .query("UPDATE uqp.AppUser SET IsActive=0 WHERE Id=@actor");
  try {
    await assert.rejects(runWriter(pools.writer!),isDenied);
  } finally {
    await db.request().input("actor",sql.BigInt,chartScope.actor)
      .query("UPDATE uqp.AppUser SET IsActive=1 WHERE Id=@actor");
  }
  assert.deepEqual(await counts(),beforeWriter);
  const created=(await runWriter(pools.writer!)).recordset[0];
  const widget=Number(created?.WidgetId),audit=Number(created?.AuditLogId);
  assert(Number.isSafeInteger(widget)&&widget>0);
  assert(Number.isSafeInteger(audit)&&audit>0);
  assert.equal(created.Digest,chartScope.digest);
  const linked=(await db.request()
    .input("request",sql.UniqueIdentifier,chartScope.requestId)
    .input("grant",sql.UniqueIdentifier,realGrant.GrantId)
    .query("SELECT r.ActorId,r.AuditLogId AS LedgerAuditId,"+
      "a.UserId AS AuditActor,a.Status,a.EventType,"+
      "w.Id AS WidgetId,w.WidgetType,w.ConfigJson,"+
      "s.ConfigDigest,s.AuditLogId AS SealAuditId,s.SealedBy,"+
      "g.ConsumedAtUtc,g.IssuerSid "+
      "FROM uqp.DashboardChartTrustRequest r "+
      "JOIN uqp.AuditLog a ON a.Id=r.AuditLogId "+
      "JOIN uqp.DashboardChartWidgetSeal s ON s.AuditLogId=a.Id "+
      "JOIN uqp.DashboardWidget w ON w.Id=s.WidgetId "+
      "JOIN uqp.ChartActorDelegationDisposable g ON g.RequestId=r.RequestId "+
      "WHERE r.RequestId=@request AND g.GrantId=@grant")
  ).recordset;
  assert.equal(linked.length,1);
  const receipt=linked[0];
  assert.equal(Number(receipt.ActorId),chartScope.actor);
  assert.equal(Number(receipt.AuditActor),chartScope.actor);
  assert.equal(Number(receipt.SealedBy),chartScope.actor);
  assert.equal(Number(receipt.LedgerAuditId),audit);
  assert.equal(Number(receipt.SealAuditId),audit);
  assert.equal(Number(receipt.WidgetId),widget);
  assert.equal(receipt.Status,"SUCCESS");
  assert.equal(receipt.EventType,"CHART_SEAL_WIDGET");
  assert.equal(receipt.WidgetType,"CHART");
  assert.equal(receipt.ConfigJson,chartJson);
  assert.equal(receipt.ConfigDigest,chartScope.digest);
  assert.equal(h64(receipt.IssuerSid as Buffer),metadata[1]?.OriginalSid);
  assert(receipt.ConsumedAtUtc instanceof Date);
  const afterWriter=await counts();
  assert.deepEqual(afterWriter,beforeWriter.map(n=>n+1));
  await assert.rejects(runWriter(pools.writer!),isDenied);
  assert.deepEqual(await counts(),afterWriter);
  console.log("CHART_ISSUE89_SQL_REAL_LOGINS_ISSUER_WRITER_ATOMIC_REPLAY_PASS");

  console.log("CHART_2B15D17_DISPOSABLE_REAL_SQL_LOGIN_SID_GRANT_ATTESTED_PASS");
  console.log("CHART_2B15D17_INDEPENDENT_HTTP_SIGNER_AND_PRODUCTION_LOGIN_RELEASE_BLOCKED");
 } finally {
  // Revoke dedicated test connections before dropping the ephemeral users.
  for(const role of roles){
    await pools[role]?.close().catch(()=>undefined);
  }
  for(const role of [...createdUsers].reverse()){
    await db.request().query("DROP USER "+sqlName(identities[role].name));
  }
  for(const role of [...createdLogins].reverse()){
    await admin.request().query("DROP LOGIN "+sqlName(identities[role].name));
  }
 }
}
