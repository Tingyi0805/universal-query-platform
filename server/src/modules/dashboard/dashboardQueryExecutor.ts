/** Bounded process-wide SQL work. Timed-out work retains its slot until the driver settles. */
export class DashboardQueryExecutor {
  private active = 0;
  private waiting: Array<() => void> = [];
  private pending = new Map<string, Promise<unknown>>();
  constructor(private limit = 4, private maxWaiting = 16, private timeoutMs = 65_000) {}

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    if (this.active >= this.limit && this.waiting.length >= this.maxWaiting) return Promise.reject(new Error("DASHBOARD_QUERY_BUSY"));
    let expired = false;
    let timer: ReturnType<typeof setTimeout>;
    const work = new Promise<T>((resolve, reject) => {
      const start = () => {
        if (expired) { reject(new Error("DASHBOARD_QUERY_TIMEOUT")); this.waiting.shift()?.(); return; }
        this.active++;
        Promise.resolve().then(job).then(resolve, reject).finally(() => {
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.limit) start(); else this.waiting.push(start);
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("DASHBOARD_QUERY_TIMEOUT")); }, this.timeoutMs);
    });
    const result = Promise.race([work, deadline]);
    this.pending.set(key, result);
    // Keep an in-flight key reserved even after its public timeout to prevent retries multiplying SQL.
    void work.finally(() => { clearTimeout(timer); this.pending.delete(key); }).catch(() => undefined);
    return result;
  }
}
export const dashboardQueryExecutor = new DashboardQueryExecutor();
