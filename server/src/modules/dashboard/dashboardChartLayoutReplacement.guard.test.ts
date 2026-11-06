import test from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import { assertChartLayoutReplacementSafe } from "./dashboardChartLayoutReplacement.guard.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import type { DashboardProfileInput } from "./dashboardLayout.repository.js";
const blocked = (e: unknown) => e instanceof QuerySourceError &&
  e.code === "CHART_LAYOUT_ATOMIC_WRITER_REQUIRED";
const request = (read: (sql: string) => unknown[]) => (() => ({
  input() { return this; },
  async query(sql: string) { return {recordset: read(sql)}; },
})) as unknown as (tx: sql.Transaction) => sql.Request;
const standard = (s: string, widget: unknown[] = [], sidecar: number | null = null) => {
  if (s.startsWith("SELECT Id FROM uqp.Dashboard WITH")) return [{Id:7}];
  if (s.startsWith("SELECT Id FROM uqp.DashboardDisplayProfile WITH")) return [{Id:22}];
  if (s.startsWith("SELECT w.Id,w.ProfileId,w.WidgetType,w.SourceKey")) return widget;
  if (s.includes("OBJECT_ID(")) return [{SealTableId:sidecar}];
  if (s.includes("JOIN uqp.DashboardChartWidgetSeal")) return [];
  throw Error("unexpected read " + s);
};
test("2B-11 refuses CHART/unknown inputs before DB access", async()=>{
  const never=request(()=>{throw Error("SQL must not be reached");});
  for(const type of ["CHART","UNKNOWN"]) {
    const profile={widgets:[{widgetType:type}]} as unknown as DashboardProfileInput;
    await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction,7,[profile],never),blocked);
  }
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction,0,[],never),blocked);
});
test("2B-11 explicit lock order protects a CHART without checking sidecar",async()=>{
  const calls:string[]=[];
  const chart=[{Id:88,ProfileId:22,WidgetType:"CHART",SourceKey:"PRIMARY"}];
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction,7,[],
    request(s=>{calls.push(s);return standard(s,chart);})
  ),blocked);
  assert.equal(calls.length,3);
  assert.match(calls[0]!,/FROM uqp.Dashboard WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(calls[1]!,/FROM uqp.DashboardDisplayProfile WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.match(calls[2]!,/FROM uqp.DashboardWidget w WITH \(UPDLOCK,HOLDLOCK\)/);
});
test("2B-11 permits legacy layouts without chart sidecar",async()=>{
  const widgets=[{Id:88,ProfileId:22,WidgetType:"TEXT",SourceKey:"PRIMARY"}];
  await assert.doesNotReject(assertChartLayoutReplacementSafe({} as sql.Transaction,7,[],
    request(s=>standard(s,widgets))
  ));
});
test("2B-11 refuses leftover inactive seal on a TEXT widget",async()=>{
  const widgets=[{Id:88,ProfileId:22,WidgetType:"TEXT",SourceKey:"PRIMARY"}];
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction,7,[],
    request(s=>s.includes("JOIN uqp.DashboardChartWidgetSeal")
      ? [{WidgetId:88}]:standard(s,widgets,123))
  ),blocked);
});
test("2B-11 rejects broken catalog or profile-widget membership",async()=>{
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction,7,[],
    request(s=>s.includes("OBJECT_ID(")?[]:standard(s))
  ),blocked);
  const orphan=[{Id:88,ProfileId:999,WidgetType:"TEXT",SourceKey:"PRIMARY"}];
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction,7,[],
    request(s=>standard(s,orphan))
  ),blocked);
});
