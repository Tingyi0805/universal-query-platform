import { z } from "zod";
import { createHash } from "node:crypto";

export const exactScopeId = z.string().regex(/^[1-9][0-9]{0,18}$/u).refine(s => BigInt(s)<=9223372036854775807n);
export const scopeEpoch = z.string().regex(/^(?!0000000000000000)[a-f0-9]{16}$/iu).transform(s=>s.toLowerCase());
export const scopeKind = z.enum(["OWNER","REVIEWER"]);
export const scopeCommand = z.object({
  requestId:z.string().uuid().transform(s=>s.toLowerCase()), action:z.enum(["GRANT","REVOKE"]),
  expectedVersion:z.union([z.literal("MISSING"),scopeEpoch]),
  definitionVersion:scopeEpoch,configurationVersion:scopeEpoch,
  parentOwnerUserId:exactScopeId.nullable(),parentOwnerVersion:scopeEpoch.nullable(),
}).strict();
export type ScopeCommand=z.infer<typeof scopeCommand>;
export class DatasetScopeError extends Error {
  constructor(readonly code:string,readonly status=409){super(code);this.name="DatasetScopeError";}
}
export const scopeFail=(code:string,status=409):never=>{throw new DatasetScopeError(code,status);};
export const scopeSafety={runtimeBindVerified:false,deliveryAllowed:false} as const;
export function explicitSystemAdminCapabilities(all:string[],selected:string[]){
  const explicit=new Set(selected);
  return all.filter(code=>!["MANAGE_DATASET_SECURITY_SCOPE","CONFIRM_DATASET_CLASSIFICATION"].includes(code)||explicit.has(code));
}
export function scopeDigest(actorId:string,datasetId:string,userId:string,kind:string,command:ScopeCommand,incarnation:string){
  return createHash("sha256").update(JSON.stringify(["DATASET_SCOPE_COMMAND_V1",actorId,datasetId,userId,kind,
    command.requestId,command.action,command.expectedVersion,command.definitionVersion,command.configurationVersion,
    command.parentOwnerUserId,command.parentOwnerVersion,incarnation])).digest("hex");
}
