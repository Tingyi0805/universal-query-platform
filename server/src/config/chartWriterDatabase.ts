// 2B-15C: a separately provisioned, security-attested SQL login pool.
// No HTTP route imports this module. Both release gates currently disable it.
import sql from "mssql";
import {env} from "./env.js";
import {getPlatformDbPool} from "./database.js";
import {attestChartWriterBaseSqlCatalog} from "../scripts/chart928WriterBaseSchema.js";
import {CHART_ATOMIC_CREATE_RUNTIME_ENABLED} from "../modules/dashboard/dashboardChartAtomicCreate.contract.js";
import {
 CHART_WRITER_APPROVED_PROCEDURE_SHA256,CHART_WRITER_DB_ACTOR_BINDING_APPROVED,
 attestChartWriterSqlPools,
} from "../modules/dashboard/dashboardChartWriterBoundary.js";
import {CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED}
 from "../modules/dashboard/dashboardChartLocalJwtSqlCreate.js";
import {CHART_SQL_APPROVED_PLATFORM_SID,CHART_SQL_APPROVED_WRITER_SID}
 from "../modules/dashboard/dashboardChartSqlPrincipalPreflight.js";

export type ChartDbSettings=Readonly<{
 enabled:boolean;platformServer?:string;platformPort:number;
 platformDatabase?:string;platformUser?:string;platformPassword?:string;
 writerServer?:string;writerPort:number;writerDatabase?:string;
 writerUser?:string;writerPassword?:string;
 writerEncrypt:boolean;writerTrustServerCertificate:boolean;
}>;
const present=(x:unknown):x is string=>typeof x==="string"&&x.trim().length>0;
const eq=(a:string,b:string)=>a.trim().toLowerCase()===b.trim().toLowerCase();

/** Reject missing configuration, credential reuse, target mismatch or
 * certificate-validation bypass. Runtime also verifies ORIGINAL_LOGIN SID.
 */
export function chartWriterSqlConfig(v:ChartDbSettings):sql.config|null{
 if(!v.enabled||!present(v.platformServer)||!present(v.platformDatabase)||
    !present(v.platformUser)||!present(v.platformPassword)||
    !present(v.writerServer)||!present(v.writerDatabase)||
    !present(v.writerUser)||!present(v.writerPassword)||
    !Number.isInteger(v.platformPort)||!Number.isInteger(v.writerPort)||
    v.platformPort<1||v.writerPort<1||v.platformPort>65535||v.writerPort>65535||
    !eq(v.platformServer,v.writerServer)||!eq(v.platformDatabase,v.writerDatabase)||
    v.platformPort!==v.writerPort||eq(v.platformUser,v.writerUser)||
    v.platformPassword===v.writerPassword||
    !v.writerEncrypt||v.writerTrustServerCertificate)return null;
 return {
  server:v.writerServer.trim(),port:v.writerPort,database:v.writerDatabase.trim(),
  user:v.writerUser.trim(),password:v.writerPassword,
  options:{encrypt:true,trustServerCertificate:false},
  pool:{min:0,max:2,idleTimeoutMillis:30000},
 };
}
const settings=():ChartDbSettings=>({
 enabled:env.CHART_WRITER_DB_ENABLED,
 platformServer:env.PLATFORM_DB_SERVER,platformPort:env.PLATFORM_DB_PORT,
 platformDatabase:env.PLATFORM_DB_DATABASE,platformUser:env.PLATFORM_DB_USER,
 platformPassword:env.PLATFORM_DB_PASSWORD,
 writerServer:env.CHART_WRITER_DB_SERVER,writerPort:env.CHART_WRITER_DB_PORT,
 writerDatabase:env.CHART_WRITER_DB_DATABASE,writerUser:env.CHART_WRITER_DB_USER,
 writerPassword:env.CHART_WRITER_DB_PASSWORD,
 writerEncrypt:env.CHART_WRITER_DB_ENCRYPT,
 writerTrustServerCertificate:env.CHART_WRITER_DB_TRUST_SERVER_CERTIFICATE,
});
let active:sql.ConnectionPool|null=null;
let connecting:Promise<sql.ConnectionPool|null>|null=null;
let generation=0;

/** Never fall back to PLATFORM_DB_USER. If attestation fails, close candidate.
 * All returned errors are null; do not log SQL credentials or connection info.
 */
export async function getChartWriterDbPool():Promise<sql.ConnectionPool|null>{
 if(!CHART_ATOMIC_CREATE_RUNTIME_ENABLED||
    !CHART_WRITER_APPROVED_PROCEDURE_SHA256||
    !CHART_SQL_APPROVED_PLATFORM_SID||!CHART_SQL_APPROVED_WRITER_SID||
    !(CHART_WRITER_DB_ACTOR_BINDING_APPROVED||
      CHART_LOCAL_JWT_WRITER_RELEASE_APPROVED))return null;
 // Option A accepts UQP as the original LOCAL JWT identity authority; SQL
 // still enforces separately approved Writer credentials/SID, procedure
 // digest, least privilege and transactional authorization.
 const pins={platform:CHART_SQL_APPROVED_PLATFORM_SID,
             writer:CHART_SQL_APPROVED_WRITER_SID};
 // A previously attested SQL connection is NOT permanently trusted.
 // Revalidate both original logins, grants and the pinned procedure digest
 // before every later pool handoff; a revoked grant or altered procedure
 // invalidates the cached pool. The DB-owned procedure still must perform
 // its own in-transaction authorization and integrity checks.
 if(active?.connected){
   try{
     const platform=await getPlatformDbPool();
     if(!platform)throw Error("PLATFORM_DB_UNAVAILABLE");
     await attestChartWriterSqlPools(platform,active,CHART_WRITER_APPROVED_PROCEDURE_SHA256,pins);
     await attestChartWriterBaseSqlCatalog(active);
     return active;
   }catch{
     await closeChartWriterDbPool().catch(()=>undefined);
     return null;
   }
 }
 if(connecting)return connecting;
 const config=chartWriterSqlConfig(settings());
 if(!config)return null;
 const epoch=generation;
 connecting=(async()=>{
   let candidate:sql.ConnectionPool|null=null;
   try{
     const platform=await getPlatformDbPool();
     if(!platform)return null;
     candidate=await new sql.ConnectionPool(config).connect();
     await attestChartWriterSqlPools(platform,candidate,CHART_WRITER_APPROVED_PROCEDURE_SHA256,pins);
     await attestChartWriterBaseSqlCatalog(candidate);
     if(epoch!==generation){await candidate.close();return null;}
     active=candidate;return active;
   }catch{
     if(candidate)await candidate.close().catch(()=>undefined);
     return null;
   }
 })();
 try{return await connecting;}finally{connecting=null;}
}
export async function closeChartWriterDbPool():Promise<void>{
 generation++;
 const pending=connecting;
 if(pending)await pending.catch(()=>null);
 const pool=active;active=null;
 if(pool)await pool.close();
}
