import assert from "node:assert/strict";
import test from "node:test";
import { startSourcePlayback, retainSourceColumns, type PlaybackClock, type PlaybackPage } from "./sourcePlayback.js";

function clock() {
  let now = 0; let next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const api: PlaybackClock = { now: () => now,
    schedule: (callback, delay) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id; },
    cancel: handle => { timers.delete(handle as number); } };
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { api, flush, count: () => timers.size, async advance(ms: number) {
    const until = now + ms;
    while (true) {
      const first = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      now = first[1].at; timers.delete(first[0]); first[1].callback(); await flush();
    }
    now = until; await flush();
  } };
}

test("independent refresh and page deadlines: SQL refresh runs even before a long page rotation", async () => {
  const c = clock(); const calls: Array<{ at: number; page: number; snapshot: string | null }> = [];
  let sql = 0;
  const stop = startSourcePlayback({ clock: c.api,
    fetchPage: async (page, snapshot) => {
      calls.push({ at: c.api.now(), page, snapshot });
      return { page, totalPages: 3, snapshotId: snapshot ?? `s${++sql}`, refreshSeconds: 5, pageSeconds: 15 };
    }, show: () => {}, clear: () => {}, unauthorized: () => assert.fail("unexpected denial") });
  await c.flush(); await c.advance(15_000);
  assert.deepEqual(calls.map(x => [x.at, x.page]), [[0, 1], [5000, 1], [10000, 1], [15000, 2]]);
  assert.equal(sql, 4); assert.equal(c.count(), 1);
  stop(); assert.equal(c.count(), 0);
});
test("paging and cycle wrap reuse a snapshot until the refresh deadline", async () => {
  const c = clock(); let sql = 0; const pages: number[] = [];
  const stop = startSourcePlayback({ clock: c.api, fetchPage: async (page, snapshot) => {
    pages.push(page); return { page, totalPages: 2, snapshotId: snapshot ?? `s${++sql}`, refreshSeconds: 30, pageSeconds: 5 };
  }, show: () => {}, clear: () => {}, unauthorized: () => {} });
  await c.flush(); await c.advance(20_000);
  assert.deepEqual(pages, [1, 2, 1, 2, 1]); assert.equal(sql, 1); stop();
});
test("sources run independently; one failure clears only its rows and backs off", async () => {
  const c = clock(); let failures = 0; let healthy = 0; let clears = 0;
  const stopBad = startSourcePlayback({ clock: c.api, fetchPage: async () => { failures++; throw new Error("synthetic failure"); },
    show: () => assert.fail(), clear: () => { clears++; }, unauthorized: () => {} });
  const stopGood = startSourcePlayback({ clock: c.api, fetchPage: async (page, snapshot) => {
    healthy++; return { page, totalPages: 2, snapshotId: snapshot ?? "good", refreshSeconds: 30, pageSeconds: 5 };
  }, show: () => {}, clear: () => {}, unauthorized: () => {} });
  await c.flush(); await c.advance(20_000);
  assert.equal(healthy, 5); assert.equal(failures, 3); assert.equal(clears, 3);
  stopBad(); stopGood(); assert.equal(c.count(), 0);
});
test("out-of-range or expired page resets safely without retry loops", async () => {
  for (const code of ["DASHBOARD_PAGE_OUT_OF_RANGE", "DASHBOARD_SNAPSHOT_EXPIRED"]) {
    const c = clock(); let calls = 0; const shown: number[] = [];
    const stop = startSourcePlayback({ clock: c.api, fetchPage: async (page, snapshot) => {
      calls++; if (calls === 2) throw Object.assign(new Error(code), { code });
      return { page, totalPages: calls > 2 ? 1 : 2, snapshotId: snapshot ?? `s${calls}`, refreshSeconds: 30, pageSeconds: 5 };
    }, show: page => { shown.push(page.page); }, clear: () => {}, unauthorized: () => {} });
    await c.flush(); await c.advance(5000); assert.deepEqual(shown, [1, 1]); assert.equal(calls, 3); stop();
  }
});
test("authorization failure stops requests; cleanup aborts and rejects late sensitive responses", async () => {
  const c = clock(); let denied = 0; let shows = 0;
  const stopDenied = startSourcePlayback({ clock: c.api, fetchPage: async () => { throw Object.assign(new Error("denied"), { status: 401 }); },
    show: () => { shows++; }, clear: () => {}, unauthorized: () => { denied++; } });
  await c.flush(); await c.advance(120_000); assert.equal(denied, 1); assert.equal(c.count(), 0); stopDenied();
  let resolve!: (page: PlaybackPage) => void; let signal!: AbortSignal;
  const stop = startSourcePlayback({ clock: c.api, fetchPage: (_page, _snapshot, s) => { signal = s; return new Promise<PlaybackPage>(r => { resolve = r; }); },
    show: () => { shows++; }, clear: () => {}, unauthorized: () => {} });
  stop(); assert.equal(signal.aborted, true);
  resolve({ page: 1, totalPages: 1, snapshotId: "late", refreshSeconds: 5, pageSeconds: 5 });
  await c.flush(); assert.equal(shows, 0); assert.equal(c.count(), 0);
});
test("clearing a failed source retains table columns and removes patient rows", () => {
  const data = { result: { columns: [{ name: "NAME" }], rows: [{ NAME: "synthetic" }] } };
  assert.deepEqual(retainSourceColumns(data), { result: { columns: [{ name: "NAME" }], rows: [] } });
  assert.equal(data.result.rows.length, 1);
});
for (const status of [403, 400, 503]) test(`source ${status} remains local while healthy sources continue refreshing`, async () => {
  const c = clock(); let unauthorized = 0, good = 0, errors = 0;
  const stopBad = startSourcePlayback({ clock: c.api, fetchPage: async () => { throw Object.assign(new Error("private error"), { status }); },
    show: () => assert.fail(), clear: () => {}, unauthorized: () => unauthorized++, failed: code => { assert.equal(code, status); errors++; } });
  const stopGood = startSourcePlayback({ clock: c.api, fetchPage: async (page, snapshot) => {
    good++; return { page, totalPages: 1, snapshotId: snapshot ?? `healthy-${good}`, refreshSeconds: 5, pageSeconds: 5 };
  }, show: () => {}, clear: () => {}, unauthorized: () => unauthorized++ });
  await c.flush(); await c.advance(20_000);
  assert.equal(unauthorized, 0); assert.equal(good, 5); assert.equal(errors, 3);
  stopBad(); stopGood(); assert.equal(c.count(), 0);
});
