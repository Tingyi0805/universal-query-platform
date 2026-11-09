// Issue #89: strict adapter for the exact SQL-owned atomic CHART Writer receipt.
// This parser does not authorize a write. Only the independently approved
// SQL Writer may produce a trusted input record.
import {timingSafeEqual} from "node:crypto";
import {canonicalChartConfig,type DormantChartCreatePlan} from "./dashboardChartAtomicCreate.contract.js";
export type SavedChartCreateReceipt=Readonly<{widgetId:number;sealRevision:string;auditLogId:string}>;
const exactRow=(v:unknown):v is Record<string,unknown>=>
  !!v&&typeof v==="object"&&!Array.isArray(v)&&
  Object.keys(v).sort().join("|")==="AuditLogId|Digest|SealRevision|WidgetId";
function widgetId(v:unknown):number|null{
  if(typeof v==="number")return Number.isSafeInteger(v)&&v>0?v:null;
  if(typeof v!=="string"&&typeof v!=="bigint")return null;
  const s=String(v);
  if(!/^[1-9][0-9]{0,15}$/.test(s))return null;
  const n=Number(s);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
// AuditLogId is a SQL BIGINT returned as decimal VARCHAR, never JS Number.
function auditId(v:unknown):string|null{
  if(typeof v!=="string"||!/^[1-9][0-9]{0,18}$/.test(v))return null;
  try{return BigInt(v)<=9223372036854775807n?v:null;}catch{return null;}
}
export function parseChartCreateSqlReceipt(
  raw:unknown,plan:DormantChartCreatePlan,
):SavedChartCreateReceipt|null{
  if(!exactRow(raw)||!plan?.config||!plan.placement||
    typeof raw.Digest!=="string"||!/^[a-f0-9]{64}$/.test(raw.Digest)||
    typeof raw.SealRevision!=="string"||!/^[a-f0-9]{16}$/.test(raw.SealRevision))
    return null;
  const canonical=canonicalChartConfig(plan.config.data);
  if(!canonical||canonical.json!==plan.config.json||
    canonical.sha256!==plan.config.sha256||
    canonical.data.dataSourceKey!==plan.sourceKey)return null;
  if(!timingSafeEqual(Buffer.from(raw.Digest,"hex"),Buffer.from(canonical.sha256,"hex")))
    return null;
  const id=widgetId(raw.WidgetId),audit=auditId(raw.AuditLogId);
  return id&&audit?Object.freeze({widgetId:id,sealRevision:raw.SealRevision,auditLogId:audit}):null;
}
