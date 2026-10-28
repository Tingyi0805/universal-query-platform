import assert from "node:assert/strict";
import test from "node:test";
import {rememberDashboardToken,readDashboardToken,forgetDashboardToken} from "./dashboardToken.js";
test("valid device secrets remain in page memory and never invoke persistent storage writes",()=>{
  rememberDashboardToken(11,"A".repeat(43));assert.equal(readDashboardToken(11),"A".repeat(43));
  forgetDashboardToken(11);assert.equal(readDashboardToken(11),null);
  for(const [id,token] of [[0,"A".repeat(43)],[11,"short"],[-1,"A".repeat(43)]] as const)assert.throws(()=>rememberDashboardToken(id,token));
});
test("legacy persistent credentials are erased and require explicit authorization",t=>{
  const data=new Map([["uqp.dashboard.device.12","A".repeat(43)]]);let writes=0;
  for(const name of ["localStorage","sessionStorage"] as const){const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,value:{getItem:(key:string)=>data.get(key)??null,removeItem:(key:string)=>data.delete(key),setItem:()=>{writes++;}}});
    t.after(()=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
  }
  assert.equal(readDashboardToken(12),null);assert.equal(data.size,0);assert.equal(writes,0);forgetDashboardToken(12);
});

import { dashboardHandoffNonce, prepareDashboardTokenHandoff, requestDashboardTokenHandoff } from "./dashboardToken.js";
function handoffWindow(t: any) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const handlers = new Map<string, Set<(event: any) => void>>(), timers = new Map<number, () => void>();
  let time = 100000, nextTimer = 0;
  t.mock.method(Date, "now", () => time);
  const sent: any[] = [];
  const opener = { closed: false, postMessage: (data: any, origin: string) => sent.push({ data, origin }) };
  const window = { location: { origin: "https://synthetic.example" }, opener: opener as unknown | null,
    addEventListener: (type: string, handler: (event: any) => void) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type)!.add(handler); },
    removeEventListener: (type: string, handler: (event: any) => void) => handlers.get(type)?.delete(handler),
    setInterval: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearInterval: (timer: number) => timers.delete(timer) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); forgetDashboardToken(15); });
  const dispatch = (data: any, source: unknown = opener, origin = window.location.origin) => {
    for (const handler of [...(handlers.get("message") ?? [])]) handler({ data, source, origin });
  };
  return { window, opener, sent, dispatch, advance: (ms: number) => { time += ms; }, tick: () => { for (const callback of [...timers.values()]) callback(); }, timers, handlers };
}
test("sender binds origin/window/document nonce, retries until ACK, then expires the one-shot grant", t => {
  const f = handoffWindow(t), results: string[] = [], nonce = dashboardHandoffNonce();
  prepareDashboardTokenHandoff(f.opener as any, 15, "B".repeat(43), result => results.push(result));
  const request = { type: "uqp.dashboard.token.request", dashboardId: 15, requestId: nonce };
  f.dispatch(request, {}); f.dispatch(request, f.opener, "https://other.example"); f.dispatch({ ...request, dashboardId: 16 });
  assert.equal(f.sent.length, 0);
  f.dispatch(request); f.dispatch(request);
  assert.equal(f.sent.length, 2); assert.equal(f.sent[0].origin, "https://synthetic.example");
  assert.equal(f.sent[0].data.handoffId, f.sent[1].data.handoffId);
  f.dispatch({ ...request, requestId: dashboardHandoffNonce() }); assert.equal(f.sent.length, 2);
  const ack = { type: "uqp.dashboard.token.ack", dashboardId: 15, requestId: nonce, handoffId: f.sent[0].data.handoffId };
  f.dispatch({ ...ack, handoffId: "wrong" }); assert.equal(results.length, 0);
  f.dispatch(ack); f.dispatch(request); f.dispatch(ack);
  assert.deepEqual(results, ["delivered"]); assert.equal(f.sent.length, 2); assert.equal(f.timers.size, 0);
  assert.equal(readDashboardToken(15), null); // Sender never caches a playback credential.
});
for (const condition of ["expired", "closed", "cancelled", "pagehide"] as const) test(`sender ${condition} destroys pending delivery`, t => {
  const f = handoffWindow(t), results: string[] = [];
  const cleanup = prepareDashboardTokenHandoff(f.opener as any, 15, "B".repeat(43), result => results.push(result));
  if (condition === "expired") f.advance(30001); // A throttled timer cannot extend authorization.
  if (condition === "closed") { f.opener.closed = true; f.tick(); }
  if (condition === "cancelled") cleanup();
  if (condition === "pagehide") for (const handler of [...(f.handlers.get("pagehide") ?? [])]) handler({});
  f.dispatch({ type: "uqp.dashboard.token.request", dashboardId: 15, requestId: dashboardHandoffNonce() });
  assert.equal(f.sent.length, 0);
  assert.deepEqual(results, condition === "expired" || condition === "closed" ? [condition] : []);
  assert.equal(f.timers.size, 0);
});
test("receiver survives effect replay with a stable nonce and accepts a token exactly once", t => {
  const f = handoffWindow(t), accepted: string[] = [], nonce = dashboardHandoffNonce(); let failed = 0;
  requestDashboardTokenHandoff(15, token => accepted.push(token), () => failed++, nonce)();
  requestDashboardTokenHandoff(15, token => accepted.push(token), () => failed++, nonce);
  const response = { type: "uqp.dashboard.token", dashboardId: 15, requestId: nonce,
    handoffId: dashboardHandoffNonce(), expiresAt: Date.now() + 30000, token: "B".repeat(43) };
  f.dispatch(response, {}); f.dispatch(response, f.opener, "https://other.example"); f.dispatch({ ...response, requestId: dashboardHandoffNonce() });
  assert.equal(accepted.length, 0);
  f.dispatch(response); f.dispatch(response); f.tick();
  assert.equal(accepted.length, 1); assert.equal(failed, 0);
  assert.equal(f.sent.filter(m => m.data.type === "uqp.dashboard.token.ack").length, 1);
  assert.equal(readDashboardToken(15), "B".repeat(43)); assert.equal(f.timers.size, 0);
});
for (const condition of ["expired", "closed", "no opener"] as const) test(`receiver reports ${condition} without remembering a secret`, t => {
  const f = handoffWindow(t); let failed = 0, accepted = 0;
  if (condition === "no opener") f.window.opener = null;
  requestDashboardTokenHandoff(15, () => accepted++, () => failed++);
  if (condition === "expired") f.advance(30001);
  if (condition === "closed") f.opener.closed = true;
  f.tick();
  assert.equal(failed, 1); assert.equal(accepted, 0); assert.equal(readDashboardToken(15), null); assert.equal(f.timers.size, 0);
});
