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
export function prepareDashboardTokenHandoff(
  popup: Window,
  id: number,
  token: string,
) {
  rememberDashboardToken(id, token);
  const origin = window.location.origin;
  const receive = (event: MessageEvent) => {
    if (
      event.origin !== origin ||
      event.source !== popup ||
      event.data?.type !== "uqp.dashboard.token.request" ||
      event.data.dashboardId !== id
    )
      return;
    popup.postMessage(
      { type: "uqp.dashboard.token", dashboardId: id, token },
      origin,
    );
    cleanup();
  };
  const timer = window.setTimeout(() => cleanup(), 30000);
  const cleanup = () => {
    window.removeEventListener("message", receive);
    window.clearTimeout(timer);
  };
  window.addEventListener("message", receive);
  return cleanup;
}
export function requestDashboardTokenHandoff(
  id: number,
  onToken: (token: string) => void,
) {
  if (!window.opener) return () => {};
  const origin = window.location.origin;
  const receive = (event: MessageEvent) => {
    if (
      event.origin !== origin ||
      event.source !== window.opener ||
      event.data?.type !== "uqp.dashboard.token" ||
      event.data.dashboardId !== id
    )
      return;
    const token = event.data.token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    rememberDashboardToken(id, token);
    onToken(token);
    window.removeEventListener("message", receive);
  };
  window.addEventListener("message", receive);
  window.opener.postMessage(
    { type: "uqp.dashboard.token.request", dashboardId: id },
    origin,
  );
  return () => window.removeEventListener("message", receive);
}
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => tokens.clear());
