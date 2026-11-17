/** PR99: Dashboard-wide read-only public-count privacy overview.
 * The existing SQL review is scope-based, NOT widget-based. Group identical
 * sources once in the Dashboard manager. Never auto-approve or weaken 928.
 */
import sql from "mssql";
import {getPlatformDbPool} from "../../config/database.js";
import {createDormantChartTrustReaders} from "./dashboardChartTrust.repository.js";
import {readDashboardChartPlaybackControl} from "./dashboardChartInheritedPlayback.js";
import {chartWidgetConfigSchema} from "./dashboardChartWidget.contract.js";
import {chartFactsDefaults,createSqlChartFactsReader} from "./dashboardChartEvidence.reader.js";
import {createVersionBoundCountProofReader} from "./dashboardChartSqlAggregate.reader.js";
import {chartPublicCountScope} from "./dashboardChartDelivery.coordinator.js";
import {evaluateServerChartApproval} from "./dashboardChartApproval.policy.js";
import type {PublicCountScope} from "./dashboardChartPublicCountPrivacy.js";

export type ChartPrivacyReviewPointer=Readonly<{
 id:number;status:"REQUESTED"|"APPROVED";revision:string;requestedBy:number;
}>;
export type ChartPrivacyScopeSummary=Readonly<{
 widgetId:number;sourceKey:string;categoryColumn:string;valueColumn:string;
 review:ChartPrivacyReviewPointer|null;currentApproval:boolean;
}>;
export type DashboardChartPrivacySummary=Readonly<{
 dashboardId:number;dashboardEnabled:boolean;
 items:ChartPrivacyScopeSummary[];
}>;

export function distinctChartPrivacyScopes(
 rows:readonly {widgetId:number;sourceKey:string;categoryColumn:string;valueColumn:string}[],
){
 const seen=new Set<string>();
 return rows.filter(row=>{
  const key=JSON.stringify([row.sourceKey.toUpperCase(),row.categoryColumn.toUpperCase(),row.valueColumn.toUpperCase()]);
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
}
const readers=createDormantChartTrustReaders();
type Actor={userId:number;tokenVersion:number;tokenHash:string};
function reviewPointer(row:Record<string,unknown>|undefined):ChartPrivacyReviewPointer|null{
 if(!row||!(row.Status==="REQUESTED"||row.Status==="APPROVED")||
    !Number.isSafeInteger(Number(row.Id))||Number(row.Id)<=0||
    !Number.isSafeInteger(Number(row.RequestedByUserId))||Number(row.RequestedByUserId)<=0||
    typeof row.Revision!=="string"||!/^[0-9a-f]{16}$/i.test(row.Revision))
   return null;
 return {id:Number(row.Id),status:row.Status,
   revision:row.Revision.toLowerCase(),requestedBy:Number(row.RequestedByUserId)};
}
export async function listDashboardChartPrivacySummary(
 dashboardId:number,actor:Actor,
):Promise<DashboardChartPrivacySummary>{
 if(!Number.isSafeInteger(dashboardId)||dashboardId<=0||
    !Number.isSafeInteger(actor.userId)||actor.userId<=0||
    !Number.isSafeInteger(actor.tokenVersion)||actor.tokenVersion<=0||
    !/^[a-f0-9]{64}$/.test(actor.tokenHash))
   throw Error("CHART_PRIVACY_SUMMARY_INVALID");
 const pool=await getPlatformDbPool();
 if(!pool)throw Error("CHART_PRIVACY_SUMMARY_UNAVAILABLE");
 // No raw CHART ConfigJson or clinical records go to the browser.
 const ids=(await pool.request().input("dashboardId",sql.BigInt,dashboardId).query(
  "SELECT TOP(101) w.Id FROM uqp.DashboardWidget w "+
  "JOIN uqp.DashboardDisplayProfile p ON p.Id=w.ProfileId "+
  "JOIN uqp.DashboardChartWidgetSeal s ON s.WidgetId=w.Id "+
  "WHERE p.DashboardId=@dashboardId AND w.WidgetType=N'CHART' AND s.IsActive=1 "+
  "ORDER BY w.Id"
 )).recordset;
 if(ids.length>100)throw Error("CHART_PRIVACY_SUMMARY_LIMIT");
 const candidates:{widgetId:number;sourceKey:string;categoryColumn:string;valueColumn:string;config:unknown}[]=[];
 for(const idRow of ids){
  const widgetId=Number(idRow.Id);
  if(!Number.isSafeInteger(widgetId)||widgetId<=0)throw Error("CHART_PRIVACY_SUMMARY_INVALID");
  const saved=await readers.readSavedWidget(dashboardId,widgetId);
  if(!saved)continue; // hidden or invalidly sealed CHART cannot authorize playback.
  const parsed=chartWidgetConfigSchema.safeParse(saved.config);
  if(!parsed.success)throw Error("CHART_PRIVACY_SUMMARY_INVALID");
  const c=parsed.data;
  candidates.push({widgetId,sourceKey:c.dataSourceKey,
   categoryColumn:c.categoryColumn,valueColumn:c.valueColumn,config:c});
 }
 const current=new Map(candidates.map(c=>[c.widgetId,c]));
 const scopes=distinctChartPrivacyScopes(candidates);
 const dashboardEnabled=!!(await readDashboardChartPlaybackControl(dashboardId));
 const items:ChartPrivacyScopeSummary[]=[];
 for(const scope of scopes){
  const config=current.get(scope.widgetId)?.config;
  if(!config)throw Error("CHART_PRIVACY_SUMMARY_INVALID");
  // This record is just a management hint. Actual playback independently
  // validates exact current scope and review before/after audited Query.
  const reviewRows=(await pool.request()
   .input("dashboardId",sql.BigInt,dashboardId)
   .input("sourceKey",sql.NVarChar(64),scope.sourceKey)
   .input("category",sql.NVarChar(128),scope.categoryColumn)
   .input("value",sql.NVarChar(128),scope.valueColumn)
   .query("SELECT TOP(1) Id,Status,CONVERT(varchar(16),ReviewRowVersion,2) AS Revision,"+
    "RequestedByUserId FROM uqp.DashboardChartPrivacyReview "+
    "WHERE DashboardId=@dashboardId AND SourceKey=@sourceKey "+
    "AND CategoryColumn=@category AND ValueColumn=@value "+
    "AND Status IN('REQUESTED','APPROVED') ORDER BY Id DESC")).recordset;
  if(reviewRows.length>1)throw Error("CHART_PRIVACY_SUMMARY_AMBIGUOUS");
  let currentApproval=false;
  if(dashboardEnabled){
   try{
    const facts=await createSqlChartFactsReader({
      ...chartFactsDefaults,
      getVerifiedAggregate:createVersionBoundCountProofReader(config),
      getPublicDisplay:chartFactsDefaults.getPublicDisplay,
    })(dashboardId,scope.sourceKey,{context:"user",...actor});
    const approved=facts&&evaluateServerChartApproval(
      chartWidgetConfigSchema.parse(config),facts,{context:"user",...actor});
    if(facts&&approved){
     const exact:PublicCountScope=chartPublicCountScope(
       facts,approved.version,chartWidgetConfigSchema.parse(config));
     currentApproval=!!(await readers.readPublicReview(
       exact,{context:"user",...actor}));
    }
   }catch{/* missing policy, revision change or SQL read is not approved */}
  }
  items.push({...scope,review:reviewPointer(reviewRows[0]),currentApproval});
 }
 return {dashboardId,dashboardEnabled,items};
}
