import test from "node:test";
import assert from "node:assert/strict";
import type sql from "mssql";
import { assertChartLayoutReplacementSafe } from "./dashboardChartLayoutReplacement.guard.js";
import { QuerySourceError } from "./dashboardQuerySources.service.js";
import type { DashboardProfileInput } from "./dashboardLayout.repository.js";

const sameCode = (err: unknown) =>
  err instanceof QuerySourceError && err.code === "CHART_LAYOUT_ATOMIC_WRITER_REQUIRED";
const request = (respond: (query: string) => unknown[]) => (() => ({
  input() { return this; },
  async query(query: string) { return { recordset: respond(query) }; },
})) as unknown as (tx: sql.Transaction) => sql.Request;

test("2B-10 rejects a CHART or unknown input before looking up the catalog", async () => {
  const never = request(() => { throw Error("unexpected DB read"); });
  const profile = { widgets: [{ widgetType: "CHART" }] } as unknown as DashboardProfileInput;
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction, 7, [profile], never), sameCode);
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction, 7, [
    { widgets: [{ widgetType: "TEXT" }, { widgetType: "NOT_ALLOWED" }] } as unknown as DashboardProfileInput,
  ], never), sameCode);
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction, 0, [], never), sameCode);
});

test("2B-10 fails closed on existing CHART with no seal catalog", async () => {
  let statements = 0;
  const fake = request(query => {
    statements++;
    if (query.startsWith("SELECT Id FROM uqp.Dashboard")) return [{ Id: 7 }];
    if (query.includes("w.WidgetType=N'CHART'")) return [{ Id: 88 }];
    throw Error("must reject before sidecar inspection");
  });
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction, 7, [], fake), sameCode);
  assert.equal(statements, 2);
});

test("2B-10 accepts only an empty legacy layout when seal sidecar is absent", async () => {
  const queries: string[] = [];
  const fake = request(query => {
    queries.push(query);
    if (query.startsWith("SELECT Id FROM uqp.Dashboard")) return [{ Id: 7 }];
    if (query.includes("w.WidgetType=N'CHART'")) return [];
    if (query.includes("OBJECT_ID")) return [{ SealTableId: null }];
    throw Error("unexpected read");
  });
  await assert.doesNotReject(assertChartLayoutReplacementSafe({} as sql.Transaction, 7, [], fake));
  assert.equal(queries.length, 3);
});

test("2B-10 sidecar exists: protected even when widget claims TEXT", async () => {
  const fake = request(query => {
    if (query.startsWith("SELECT Id FROM uqp.Dashboard")) return [{ Id: 7 }];
    if (query.includes("w.WidgetType=N'CHART'")) return [];
    if (query.includes("OBJECT_ID")) return [{ SealTableId: 123 }];
    if (query.includes("JOIN uqp.DashboardChartWidgetSeal")) return [{ WidgetId: 88 }];
    throw Error("unexpected read");
  });
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction, 7, [], fake), sameCode);
});

test("2B-10 fails closed on broken schema metadata rather than assuming no seals", async () => {
  const fake = request(query => {
    if (query.startsWith("SELECT Id FROM uqp.Dashboard")) return [{ Id: 7 }];
    if (query.includes("w.WidgetType=N'CHART'")) return [];
    if (query.includes("OBJECT_ID")) return [];
    throw Error("unexpected read");
  });
  await assert.rejects(assertChartLayoutReplacementSafe({} as sql.Transaction, 7, [], fake), sameCode);
});
