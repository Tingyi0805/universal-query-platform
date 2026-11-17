import sql from "mssql";
import {getPlatformDbPool} from "../../config/database.js";
import {writeAuditEvent} from "../audit/audit.repository.js";
import {QueryDeliveryError,type RuntimeIdentity} from "./queryDelivery.js";
import {parseHierarchyGraph,type HierarchyGraph} from "./queryHierarchy.contract.js";
export type HierarchyIdentity=(tx?:sql.Transaction)=>Promise<RuntimeIdentity>;
export type HierarchySaved={graph:HierarchyGraph;revision:string;bindings:Record<string,string>};
export const hierarchyCatalogSql=`IF OBJECT_ID(N'uqp.QueryHierarchyConfiguration',N'U') IS NULL
 OR COALESCE(HAS_PERMS_BY_NAME(N'uqp.QueryHierarchyConfiguration',N'OBJECT',N'VIEW DEFINITION'),0)<>1
 THROW 51929,'HIERARCHY_SCHEMA_REQUIRED',1;
DECLARE @object int=OBJECT_ID(N'uqp.QueryHierarchyConfiguration');
IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=@object)<>7 OR EXISTS(
 SELECT 1 FROM (VALUES(N'RootQueryId',127,8,0),(N'GraphJson',231,-1,0),(N'BindingJson',231,-1,0),(N'UpdatedByUserId',127,8,0),
 (N'UpdatedAtUtc',42,7,3),(N'AuditLogId',127,8,0),(N'ConfigRowVersion',189,8,0)) e(Name,TypeId,Length,Scale)
 LEFT JOIN sys.columns c ON c.object_id=@object AND c.name=e.Name WHERE c.column_id IS NULL OR c.system_type_id<>e.TypeId
 OR c.user_type_id<>e.TypeId OR c.max_length<>e.Length OR c.scale<>e.Scale OR c.is_nullable<>0 OR c.is_computed<>0 OR c.is_identity<>0)
 OR (SELECT COUNT(*) FROM sys.indexes WHERE object_id=@object AND index_id>0)<>1
 OR NOT EXISTS(SELECT 1 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
 WHERE i.object_id=@object AND i.is_primary_key=1 AND i.is_unique=1 AND i.is_disabled=0 AND i.has_filter=0 AND i.type=1
 AND ic.key_ordinal=1 AND COL_NAME(ic.object_id,ic.column_id)=N'RootQueryId')
 OR (SELECT COUNT(*) FROM sys.index_columns WHERE object_id=@object AND index_id>0)<>1
 OR EXISTS(SELECT 1 FROM sys.triggers WHERE parent_id=@object)
 OR (SELECT COUNT(*) FROM sys.foreign_keys WHERE parent_object_id=@object)<>2
 OR (SELECT COUNT(*) FROM sys.foreign_key_columns WHERE parent_object_id=@object)<>2
 OR EXISTS(SELECT 1 FROM (VALUES(N'RootQueryId',N'QueryDefinition'),(N'UpdatedByUserId',N'AppUser')) e(Col,Target)
 WHERE NOT EXISTS(SELECT 1 FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
 WHERE f.parent_object_id=@object AND f.is_disabled=0 AND f.is_not_trusted=0 AND f.is_not_for_replication=0
 AND f.delete_referential_action=0 AND f.update_referential_action=0 AND COL_NAME(fc.parent_object_id,fc.parent_column_id)=e.Col
 AND fc.referenced_object_id=OBJECT_ID(N'uqp.'+e.Target) AND COL_NAME(fc.referenced_object_id,fc.referenced_column_id)=N'Id'))
 OR (SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=@object)<>3
 OR EXISTS(SELECT 1 FROM sys.check_constraints WHERE parent_object_id=@object AND (is_disabled=1 OR is_not_trusted=1 OR is_not_for_replication=1))
 THROW 51929,'HIERARCHY_SCHEMA_MISMATCH',1;
DECLARE @checks TABLE(Definition nvarchar(max));
INSERT @checks SELECT LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(definition,N'[',N''),N']',N''),N'(',N''),N')',N''),N' ',N''),CHAR(13),N''),CHAR(10),N''),CHAR(9),N'')) FROM sys.check_constraints WHERE parent_object_id=@object;
IF NOT EXISTS(SELECT 1 FROM @checks WHERE Definition=N'isjsongraphjson=1anddatalengthgraphjson<=65536')
 OR NOT EXISTS(SELECT 1 FROM @checks WHERE Definition=N'isjsonbindingjson=1anddatalengthbindingjson<=16384')
 OR NOT EXISTS(SELECT 1 FROM @checks WHERE Definition=N'rootqueryid>0andupdatedbyuserid>0andauditlogid>0')
 OR (SELECT COUNT(*) FROM sys.default_constraints WHERE parent_object_id=@object)<>1
 OR NOT EXISTS(SELECT 1 FROM sys.default_constraints WHERE parent_object_id=@object AND COL_NAME(parent_object_id,parent_column_id)=N'UpdatedAtUtc'
 AND LOWER(REPLACE(REPLACE(REPLACE(definition,N'(',N''),N')',N''),N' ',N''))=N'sysutcdatetime')
 THROW 51929,'HIERARCHY_SCHEMA_MISMATCH',1;`;

const rev=(v:unknown)=>Buffer.isBuffer(v)&&v.length===8?v.toString("hex"):null;
// Request.query uses sp_executesql: SET options in a previous RPC are not an
// owner-wide guarantee. Put them in the SAME batch as every protected statement.
const ownedSql=(text:string)=>"SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;\n"+text;
export const hierarchyRepositoryDependencies={getPool:getPlatformDbPool,audit:writeAuditEvent};
export function createQueryHierarchyRepository(deps=hierarchyRepositoryDependencies){
 async function pool(){const p=await deps.getPool();if(!p)throw new QueryDeliveryError("HIERARCHY_SCHEMA_REQUIRED",503);return p;}
 async function read(root:number):Promise<HierarchySaved|null>{
  try{const p=await pool();await p.request().query(hierarchyCatalogSql);
   const rows=(await p.request().input("root",sql.BigInt,root).query("SELECT GraphJson,BindingJson,ConfigRowVersion FROM uqp.QueryHierarchyConfiguration WHERE RootQueryId=@root")).recordset;
   if(!rows.length)return null;const r=rev(rows[0].ConfigRowVersion);if(rows.length!==1||!r)throw Error();
   const graph=parseHierarchyGraph(JSON.parse(rows[0].GraphJson)),bindings=JSON.parse(rows[0].BindingJson);
   if(!bindings||typeof bindings!=="object"||Array.isArray(bindings)||Object.keys(bindings).length!==graph.nodes.length||graph.nodes.some(n=>typeof bindings[n.id]!=="string"||!/^[a-f0-9]{64}$/.test(bindings[n.id])))throw Error();
   return {graph,bindings,revision:r};
  }catch{throw new QueryDeliveryError("HIERARCHY_SCHEMA_REQUIRED",503);}
 }
 async function requireAdmin(identity:HierarchyIdentity,tx?:sql.Transaction){
  const actor=await identity(tx);if(actor.pinSession||!actor.permissions.includes("PUBLISH_QUERY"))throw new QueryDeliveryError("FORBIDDEN",403);
  const request=tx?new sql.Request(tx):(await pool()).request();
  const adminSql=`SELECT u.Id FROM uqp.AppUser u WITH(HOLDLOCK)
   WHERE u.Id=@actor AND u.IsActive=1 AND EXISTS(SELECT 1 FROM uqp.UserRole ur WITH(HOLDLOCK)
   JOIN uqp.Role r WITH(HOLDLOCK) ON r.Id=ur.RoleId WHERE ur.UserId=u.Id AND r.Code=N'SYSTEM_ADMIN' AND r.IsActive=1)`;
  const rows=(await request.input("actor",sql.BigInt,actor.userId).query(tx?ownedSql(adminSql):adminSql)).recordset;
  if(rows.length!==1)throw new QueryDeliveryError("FORBIDDEN",403);return actor;
 }
 async function save(root:number,graph:HierarchyGraph,expected:string,identity:HierarchyIdentity,validate:(tx:sql.Transaction)=>Promise<Record<string,string>>){
  const p=await pool(),tx=new sql.Transaction(p);let committing=false,rolledBack=false;
  tx.on("rollback",()=>{rolledBack=true;});
  try{await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await new sql.Request(tx).query("SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;");
   await new sql.Request(tx).query(ownedSql(hierarchyCatalogSql));const actor=await requireAdmin(identity,tx);
   const before=(await new sql.Request(tx).input("root",sql.BigInt,root).query(ownedSql("SELECT ConfigRowVersion FROM uqp.QueryHierarchyConfiguration WITH(UPDLOCK,HOLDLOCK) WHERE RootQueryId=@root"))).recordset;
   if((before.length?rev(before[0].ConfigRowVersion):"MISSING")!==expected)throw new QueryDeliveryError("HIERARCHY_CAS_CONFLICT");
   const bindings=await validate(tx);
   const audit=await deps.audit({eventType:"QUERY_HIERARCHY_UPDATED",userId:actor.userId,queryDefinitionId:root,status:"SUCCESS",parameters:{nodeCount:graph.nodes.length,edgeCount:graph.edges.length}},tx);
   if(!Number.isSafeInteger(audit)||audit<=0)throw new QueryDeliveryError("QUERY_AUDIT_REQUIRED",503);
   const request=new sql.Request(tx).input("root",sql.BigInt,root).input("graph",sql.NVarChar(sql.MAX),JSON.stringify(graph)).input("bindings",sql.NVarChar(sql.MAX),JSON.stringify(bindings)).input("actor",sql.BigInt,actor.userId).input("audit",sql.BigInt,audit);
   const output=before.length?await request.input("expected",sql.Binary,Buffer.from(expected,"hex")).query(ownedSql(`UPDATE uqp.QueryHierarchyConfiguration SET GraphJson=@graph,BindingJson=@bindings,UpdatedByUserId=@actor,AuditLogId=@audit,UpdatedAtUtc=SYSUTCDATETIME()
    OUTPUT inserted.ConfigRowVersion Revision WHERE RootQueryId=@root AND ConfigRowVersion=@expected`)):await request.query(ownedSql(`INSERT uqp.QueryHierarchyConfiguration(RootQueryId,GraphJson,BindingJson,UpdatedByUserId,AuditLogId) OUTPUT inserted.ConfigRowVersion Revision VALUES(@root,@graph,@bindings,@actor,@audit)`));
   const revision=output.recordset.length===1?rev(output.recordset[0].Revision):null;if(!revision)throw new QueryDeliveryError("HIERARCHY_CAS_CONFLICT");
   if(JSON.stringify(await validate(tx))!==JSON.stringify(bindings))throw new QueryDeliveryError("HIERARCHY_BINDING_CHANGED");await requireAdmin(identity,tx);committing=true;await tx.commit();return {revision};
  }catch(e){if(committing)throw new QueryDeliveryError("HIERARCHY_COMMIT_UNKNOWN_DO_NOT_RETRY",503);
   if(!rolledBack)try{await tx.rollback();}catch{throw new QueryDeliveryError("HIERARCHY_ROLLBACK_UNKNOWN",503);}throw e;}
 }
 return {read,save,requireAdmin};
}
export const queryHierarchyRepository=createQueryHierarchyRepository();
/** Exact source/query revision evidence; no SQL text or credentials leave this reader. */
export async function readHierarchyQueryRevision(queryId:number,tx?:sql.Transaction):Promise<string>{
 const p=tx?null:await getPlatformDbPool();if(!tx&&!p)throw new QueryDeliveryError("HIERARCHY_VERSION_UNAVAILABLE",503);
 const r=(await (tx?new sql.Request(tx):p!.request()).input("q",sql.BigInt,queryId).query(`SELECT d.DefinitionRowVersion D,s.ConfigurationRowVersion S,
  CONVERT(varchar(20),(SELECT MAX(v.VersionNo) FROM uqp.QueryDefinitionVersion v WITH(HOLDLOCK) WHERE v.QueryDefinitionId=q.Id)) Q
  FROM uqp.QueryDefinition q WITH(HOLDLOCK) JOIN uqp.Dataset d WITH(HOLDLOCK) ON d.Id=q.DatasetId
  JOIN uqp.DataSource s WITH(HOLDLOCK) ON s.Id=d.DataSourceId WHERE q.Id=@q AND s.IsActive=1`)).recordset;
 if(r.length!==1||!rev(r[0].D)||!rev(r[0].S)||!/^[1-9][0-9]*$/.test(r[0].Q??""))throw new QueryDeliveryError("HIERARCHY_VERSION_UNAVAILABLE",503);
 return `${r[0].Q}:${rev(r[0].D)}:${rev(r[0].S)}`;
}
