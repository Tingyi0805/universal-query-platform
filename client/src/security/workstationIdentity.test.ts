import test from "node:test";
import assert from "node:assert/strict";
import { WorkstationIdentity } from "./workstationIdentity.js";
test("clearing A aborts requests and rejects late successful A responses even if transport ignores abort", async () => {
  const fence = new WorkstationIdentity(); let resolve!: (value: string) => void; let signal!: AbortSignal;
  const old = fence.run(s => { signal = s; return new Promise<string>(r => { resolve = r; }); });
  fence.clear(); assert.equal(signal.aborted, true);
  assert.equal(await fence.run(async () => "B"), "B");
  resolve("A secret"); await assert.rejects(old, /IDENTITY_CHANGED/);
});
