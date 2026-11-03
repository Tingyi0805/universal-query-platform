/** Per-view fence: cancellation saves work; the monotonically increasing epoch
 * is the authority even when a transport delivers an aborted response.
 */
export class WorkstationIdentity {
  private epoch = 0;
  private pending = new Set<AbortController>();
  clear() { this.epoch++; for (const controller of this.pending) controller.abort(); this.pending.clear(); }
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const epoch = this.epoch, controller = new AbortController();
    this.pending.add(controller);
    try {
      const value = await work(controller.signal);
      if (epoch !== this.epoch) throw new Error("WORKSTATION_IDENTITY_CHANGED");
      return value;
    } finally { this.pending.delete(controller); }
  }
}
