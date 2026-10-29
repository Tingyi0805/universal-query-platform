// Device secrets stay in this tab's memory. Never write tokens to browser storage or URLs.
const tokens = new Map<number, string>();
export function rememberDashboardToken(id: number, token: string) {
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    throw new Error("裝置 Token 格式不正確。");
  if (tokens.size >= 20 && !tokens.has(id))
    tokens.delete(tokens.keys().next().value!);
  try {
    localStorage.removeItem(`uqp.dashboard.device.${id}`);
    sessionStorage.removeItem(`uqp.dashboard.device.${id}`);
  } catch {}
  tokens.set(id, token);
}
export function forgetDashboardToken(id: number) {
  tokens.delete(id);
  try {
    localStorage.removeItem(`uqp.dashboard.device.${id}`);
    sessionStorage.removeItem(`uqp.dashboard.device.${id}`);
  } catch {
    /* storage may be disabled */
  }
}
export function readDashboardToken(id: number): string | null {
  if (tokens.has(id)) return tokens.get(id)!;
  // Persistent legacy secrets are not proof of a fresh authorization after restart.
  // Erase them; only explicit activation or the trusted one-shot window handoff can fill memory.
  try {
    localStorage.removeItem(`uqp.dashboard.device.${id}`);
    sessionStorage.removeItem(`uqp.dashboard.device.${id}`);
  } catch {}

  return null;
}
const HANDOFF_MS = 30000;
// getRandomValues also works on same-origin HTTP intranets, where randomUUID
// is not exposed. No fallback to predictable randomness.
export function dashboardHandoffNonce(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const validNonce = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
export function prepareDashboardTokenHandoff(
  popup: Window, id: number, token: string,
  onResult: (result: "delivered" | "expired" | "closed") => void = () => {},
) {
  if (!Number.isSafeInteger(id) || id <= 0 || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("裝置 Token 格式不正確。");
  if (new URL(window.location.origin).protocol !== "https:") { onResult("closed"); return () => {}; }
  const origin = window.location.origin, expiresAt = Date.now() + HANDOFF_MS, monotonicDeadline = performance.now() + HANDOFF_MS;
  const handoffId = dashboardHandoffNonce();
  let secret: string | null = token, requestId: string | null = null, active = true;
  const cleanup = () => {
    active = false; secret = null;
    window.removeEventListener("message", receive); window.clearInterval(timer);
    window.removeEventListener("pagehide", cleanup);
  };
  const finish = (result: "delivered" | "expired" | "closed") => { cleanup(); onResult(result); };
  const receive = (event: MessageEvent) => {
    if (!active || event.origin !== origin || event.source !== popup || event.data?.dashboardId !== id) return;
    if ((Date.now() >= expiresAt || performance.now() >= monotonicDeadline)) { finish("expired"); return; }
    const data = event.data;
    if (data.type === "uqp.dashboard.token.ack" && data.requestId === requestId && data.handoffId === handoffId) { finish("delivered"); return; }
    if (data.type !== "uqp.dashboard.token.request" || !validNonce(data.requestId) || requestId !== null && requestId !== data.requestId) return;
    requestId = data.requestId;
    // Retransmit only to the same document request until acknowledged. Acceptance
    // is one-shot; navigation/replay with another nonce cannot consume this grant.
    try { popup.postMessage({ type: "uqp.dashboard.token", dashboardId: id, requestId, handoffId, expiresAt, token: secret }, origin); }
    catch { finish("closed"); }
  };
  const timer = window.setInterval(() => {
    if (!active) return;
    if ((Date.now() >= expiresAt || performance.now() >= monotonicDeadline)) finish("expired");
    else if (popup.closed) finish("closed");
  }, 250);
  window.addEventListener("message", receive); window.addEventListener("pagehide", cleanup);
  return cleanup;
}
export function requestDashboardTokenHandoff(
  id: number, onToken: (token: string) => void,
  onFailure: () => void = () => {}, requestId = dashboardHandoffNonce(),
) {
  if (new URL(window.location.origin).protocol !== "https:") { onFailure(); return () => {}; }
  const opener: Window | null = window.opener;
  if (!opener) { onFailure(); return () => {}; }
  const origin = window.location.origin, deadline = Date.now() + HANDOFF_MS, monotonicDeadline = performance.now() + HANDOFF_MS;
  let active = true;
  const cleanup = () => {
    active = false; window.removeEventListener("message", receive); window.clearInterval(timer);
    window.removeEventListener("pagehide", cleanup);
  };
  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (!active || event.origin !== origin || event.source !== opener || data?.type !== "uqp.dashboard.token" ||
        data.dashboardId !== id || data.requestId !== requestId || !validNonce(data.handoffId)) return;
    if ((Date.now() >= deadline || performance.now() >= monotonicDeadline) || !Number.isSafeInteger(data.expiresAt) || Date.now() >= data.expiresAt) { cleanup(); onFailure(); return; }
    const token = data.token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    cleanup();
    rememberDashboardToken(id, token);
    try { opener.postMessage({ type: "uqp.dashboard.token.ack", dashboardId: id, requestId, handoffId: data.handoffId }, origin); }
    catch { forgetDashboardToken(id); onFailure(); return; }
    onToken(token);
  };
  const request = () => {
    if (!active) return;
    if ((Date.now() >= deadline || performance.now() >= monotonicDeadline) || opener.closed) { cleanup(); onFailure(); return; }
    try { opener.postMessage({ type: "uqp.dashboard.token.request", dashboardId: id, requestId }, origin); }
    catch { cleanup(); onFailure(); }
  };
  const timer = window.setInterval(request, 250);
  window.addEventListener("message", receive); window.addEventListener("pagehide", cleanup);
  request();
  return cleanup;
}
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => tokens.clear());
