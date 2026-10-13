export type PlaybackPage = { page: number; totalPages: number; snapshotId: string; refreshSeconds: number; pageSeconds: number };
export type PlaybackClock = { now(): number; schedule(callback: () => void, delay: number): unknown; cancel(handle: unknown): void };
const browserClock: PlaybackClock = { now: Date.now, schedule: (f, ms) => setTimeout(f, ms), cancel: h => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Each source has separate SQL-refresh and rotation deadlines, one request and one timer. */
export function startSourcePlayback<T extends PlaybackPage>(options: {
  fetchPage(page: number, snapshotId: string | null, signal: AbortSignal): Promise<T>;
  show(page: T): void;
  clear(): void;
  unauthorized(): void;
  failed?(status?: number): void;
  clock?: PlaybackClock;
}) {
  const clock = options.clock ?? browserClock;
  let stopped = false;
  let timer: unknown;
  let controller: AbortController | undefined;
  let snapshot: string | null = null;
  let page = 1;
  let totalPages = 1;
  let refreshAt = 0;
  let rotateAt = 0;
  let failures = 0;
  const tick = async () => {
    if (stopped) return;
    const refreshDue = !snapshot || clock.now() >= refreshAt;
    const rotateDue = snapshot !== null && clock.now() >= rotateAt;
    const requestedPage = rotateDue ? page % totalPages + 1 : page;
    controller = new AbortController();
    try {
      let result: T;
      try {
        result = await options.fetchPage(requestedPage, refreshDue ? null : snapshot, controller.signal);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "DASHBOARD_SNAPSHOT_EXPIRED" && code !== "DASHBOARD_PAGE_OUT_OF_RANGE") throw error;
        options.clear();
        snapshot = null;
        result = await options.fetchPage(1, null, controller.signal);
      }
      if (stopped || controller.signal.aborted) return;
      const now = clock.now();
      const newSnapshot = snapshot !== result.snapshotId;
      snapshot = result.snapshotId;
      page = result.page;
      totalPages = Math.max(1, result.totalPages);
      if (newSnapshot) refreshAt = now + Math.max(5, Math.min(3600, result.refreshSeconds)) * 1000;
      if (!rotateAt || rotateDue || page !== requestedPage) rotateAt = now + Math.max(5, Math.min(3600, result.pageSeconds)) * 1000;
      options.show(result);
      failures = 0;
      timer = clock.schedule(() => void tick(), Math.max(1, Math.min(refreshAt, rotateAt) - now));
    } catch (error) {
      if (stopped || controller.signal.aborted) return;
      snapshot = null;
      rotateAt = 0;
      options.clear();
      options.failed?.((error as { status?: number }).status);
      // Query/source 403 is local. Only a revoked authentication credential stops all playback.
      if ((error as { status?: number }).status === 401) {
        stopped = true;
        options.unauthorized();
        return;
      }
      failures++;
      timer = clock.schedule(() => void tick(), Math.min(60_000, 5000 * 2 ** Math.min(failures - 1, 4)));
    }
  };
  void tick();
  return () => { stopped = true; controller?.abort(); clock.cancel(timer); options.clear(); };
}

/** A page with a fixed header keeps its approved columns while loading or isolated source failures. */
export function retainSourceColumns<T extends { result: { columns: { name: string }[]; rows: Record<string, unknown>[] } }>(page: T): T {
  return { ...page, result: { ...page.result, rows: [] } };
}
