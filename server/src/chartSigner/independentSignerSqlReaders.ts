// Separate-process, read-only SQL authorization adapter for CHART signing.
// Must be given a dedicated least-privilege SQL login by its own process;
// NEVER call the ordinary UQP getPlatformDbPool or use the Issuer/Writer login.
// This is strict future QUERY_ONLY eligibility, not a public privacy review
// or an alternative to the Writer's transactional revalidation.
import sql from "mssql";
import type {IndependentSignerLiveSession} from "./independentChartSigner.js";

const isId=(x:number)=>Number.isSafeInteger(x)&&x>0;
const sourceKeyPattern=/^(?:PRIMARY|[A-Za-z][A-Za-z0-9_]{0,63})$/;

export function createIndependentSignerSqlReaders(pool:sql.ConnectionPool){
  return {
    readLiveSession:async(actorId:number):Promise<IndependentSignerLiveSession|null>=>{
      if(!isId(actorId))return null;
      try{
        const result=await pool.request().input("userId",sql.BigInt,actorId)
          .query(`
            SELECT TOP(1) IsActive,TokenVersion
            FROM uqp.AppUser WHERE Id=@userId;
            SELECT DISTINCT p.Code FROM uqp.UserRole ur
            JOIN uqp.Role r ON r.Id=ur.RoleId AND r.IsActive=1
            JOIN uqp.RolePermission rp ON rp.RoleId=r.Id
            JOIN uqp.Permission p ON p.Id=rp.PermissionId
            WHERE ur.UserId=@userId;`);
        const session=result.recordsets?.[0]?.[0];
        const permissions=result.recordsets?.[1];
        const version=Number(session?.TokenVersion);
        if(!session||!Number.isSafeInteger(version)||version<1||
           !Array.isArray(permissions))return null;
        return {
          isActive:Boolean(session.IsActive),
          tokenVersion:version,
          permissions:permissions.map(r=>String(r.Code)),
        };
      }catch{return null;}
    },
    authorizeChartCreate:async(
      actorId:number,dashboardId:number,profileId:number,sourceKey:string,
    ):Promise<boolean>=>{
      if(!isId(actorId)||!isId(dashboardId)||!isId(profileId)||
         !sourceKeyPattern.test(sourceKey))return false;
      try{
        const result=await pool.request()
          .input("actorId",sql.BigInt,actorId)
          .input("dashboardId",sql.BigInt,dashboardId)
          .input("profileId",sql.BigInt,profileId)
          .input("sourceKey",sql.NVarChar(64),sourceKey)
          .query(`
            SELECT CAST(1 AS bit) AS Approved
            FROM uqp.AppUser actor
            JOIN uqp.Dashboard d ON d.Id=@dashboardId
              AND d.IsActive=1 AND d.QueryMode=N'QUERY_ONLY'
            JOIN uqp.DashboardDisplayProfile profile
              ON profile.Id=@profileId AND profile.DashboardId=d.Id
            JOIN uqp.DashboardDataSource ds ON ds.DashboardId=d.Id
              AND ds.SourceKey=@sourceKey AND ds.IsEnabled=1
              AND ds.QueryDefinitionId IS NOT NULL
            JOIN uqp.QueryDefinition q ON q.Id=ds.QueryDefinitionId
              AND q.IsActive=1 AND q.IsPublished=1 AND q.IsArchived=0
              AND q.DatasetId=ds.DatasetId
            JOIN uqp.Dataset dataset ON dataset.Id=q.DatasetId
              AND dataset.IsActive=1 AND dataset.IsArchived=0
            JOIN uqp.DataSource source ON source.Id=dataset.DataSourceId
              AND source.IsActive=1
            WHERE actor.Id=@actorId AND actor.IsActive=1
              AND NOT EXISTS(
                SELECT 1 FROM uqp.DatasetParameter dp
                JOIN uqp.Dataset lookup ON lookup.Id=dp.LookupDatasetId
                WHERE dp.DatasetId=dataset.Id AND lookup.IsArchived=1)
              AND (
                EXISTS(SELECT 1 FROM uqp.UserQueryAccess ua
                  WHERE ua.UserId=@actorId
                    AND ua.QueryDefinitionId=q.Id AND ua.CanView=1)
                OR EXISTS(SELECT 1 FROM uqp.UserRole ur
                  JOIN uqp.Role role ON role.Id=ur.RoleId AND role.IsActive=1
                  JOIN uqp.RoleQueryAccess ra ON ra.RoleId=role.Id
                  WHERE ur.UserId=@actorId
                    AND ra.QueryDefinitionId=q.Id AND ra.CanView=1)
              )
              AND (
                EXISTS(SELECT 1 FROM uqp.UserQueryAccess ua
                  WHERE ua.UserId=@actorId
                    AND ua.QueryDefinitionId=q.Id AND ua.CanExecute=1)
                OR EXISTS(SELECT 1 FROM uqp.UserRole ur
                  JOIN uqp.Role role ON role.Id=ur.RoleId AND role.IsActive=1
                  JOIN uqp.RoleQueryAccess ra ON ra.RoleId=role.Id
                  WHERE ur.UserId=@actorId
                    AND ra.QueryDefinitionId=q.Id AND ra.CanExecute=1)
              );`);
        return result.recordset?.length===1 &&
          result.recordset[0]?.Approved===true;
      }catch{
        // Missing/incompatible schema or read privilege is always DENY.
        return false;
      }
    },
  };
}
