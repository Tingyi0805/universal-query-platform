import test from "node:test";
import assert from "node:assert/strict";
import {hasSealedChartWidgets} from "./nativeChartLayoutGuard";

test("ordinary legacy widgets do not block existing dashboard layout saves",()=>{
  assert.equal(hasSealedChartWidgets([]),false);
  assert.equal(hasSealedChartWidgets([{widgets:[{widgetType:"TEXT"},{widgetType:"TABLE"}]}]),false);
});

test("a sealed CHART in any profile blocks entire legacy whole-layout overwrite",()=>{
  const profiles=[{widgets:[{widgetType:"TEXT"}]},{widgets:[{widgetType:"CHART"},{widgetType:"TABLE"}]}] as const;
  assert.equal(hasSealedChartWidgets(profiles),true);
  assert.equal(profiles[1].widgets[0].widgetType,"CHART");
  assert.equal(hasSealedChartWidgets([{widgets:[{widgetType:"CHART"}]}]),true);
});
