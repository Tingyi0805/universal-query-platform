import { readFile } from "node:fs/promises";
import { renderExactSidecarCatalogSql, type Catalog923Row } from "./datasetMetadata923Catalog.js";

export const bindingTable = "DatasetSecurityScopeBinding";
export const scopeCapabilities = ["MANAGE_DATASET_SECURITY_SCOPE", "CONFIRM_DATASET_CLASSIFICATION"] as const;
// Exact SQL Server 2019 persisted text. An unknown serializer must reject, not normalize target expressions.
export const bindingCheck = "(case when [DatasetId]>(0) AND [UserId]>(0) AND [SubjectTokenVersion]>(0) AND [ScopeVersion]<>0x0000000000000000 AND [DefinitionVersion]<>0x0000000000000000 AND [ConfigurationVersion]<>0x0000000000000000 AND ([ScopeKind]=N'OWNER' AND datalength([ScopeKind])=(10) AND [ParentScopeVersion] IS NULL AND [ParentTokenVersion] IS NULL OR [ScopeKind]=N'REVIEWER' AND datalength([ScopeKind])=(16) AND [ParentScopeVersion] IS NOT NULL AND [ParentScopeVersion]<>0x0000000000000000 AND [ParentTokenVersion] IS NOT NULL AND [ParentTokenVersion]>(0)) then (1) else (0) end=(1))|0|0|0|0|0|1";
export function expected924Catalog(): Catalog923Row[] {
  const rows:Catalog923Row[]=[];
  const add=(category:string,name:string,signature:string,owner=bindingTable)=>rows.push({category,owner,name,signature});
  add("OBJECT",bindingTable,"U|0","uqp"); add("TABLE",bindingTable,"0|0|0|0|0|0");add("ROWVERSION_COUNT",bindingTable,"0");
  const columns=[
    ["DatasetId","bigint",8,19,0],["UserId","bigint",8,19,0],["ScopeKind","nvarchar",16,0,0],
    ["ScopeVersion","binary",8,0,0],["SubjectTokenVersion","int",4,10,0],["DefinitionVersion","binary",8,0,0],
    ["ConfigurationVersion","binary",8,0,0],["ParentScopeVersion","binary",8,0,1],["ParentTokenVersion","int",4,10,1],
    ["PlatformIncarnation","uniqueidentifier",16,0,0],
  ] as const;
  columns.forEach(([name,type,length,precision,nullable],i)=>add("COLUMN",name,
    `${i+1}|${type}|${length}|${precision}|0|${nullable}|${type==="nvarchar"?"Latin1_General_100_BIN2":"NULL"}|0|NULL|NULL|0|0|0|0|0|0|0|0`));
  add("INDEX","PK_"+bindingTable,"1|1|0|0|0|1|0|DatasetId:ASC,UserId:ASC,ScopeKind:ASC||NULL|0|1|1|0");
  add("KEY","PK_"+bindingTable,"PK|PK_"+bindingTable+"|0");
  add("FK","FK_"+bindingTable+"_Dataset","DatasetId|uqp.Dataset|Id|0|0|0|0|0|0");
  add("FK","FK_"+bindingTable+"_User","UserId|uqp.AppUser|Id|0|0|0|0|0|0");
  add("CHECK","CK_"+bindingTable+"_Values",bindingCheck);
  return rows;
}
export function render924CatalogSql(){
  return renderExactSidecarCatalogSql(expected924Catalog(),[bindingTable],
    ["PK_","FK_","FK_","CK_"].map((prefix,i)=>[prefix+bindingTable+["","_Dataset","_User","_Values"][i],bindingTable]),
    "__UQP924_NO_SEQUENCE_EXPECTED__");
}
export async function read924Draft(){
  return readFile(new URL("../../../../database/drafts/924_dataset_security_scope_binding.sql",import.meta.url),"utf8");
}
/** Installer owns the outer transaction. Keep the standalone reviewed draft's transaction inside it. */
export async function render924InstallBatch(){
  const draft=await read924Draft();
  // SQL Server cannot catch compilation errors at the same execution level. The caller runs this as a nested batch.
  return draft;
}
