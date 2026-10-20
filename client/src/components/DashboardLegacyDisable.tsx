import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { managementError } from "../dashboard/querySourceManagement";
type State = { dashboardId: number; mode: "LEGACY"; isActive: boolean; version: string };
export function DashboardLegacyDisable({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const [state, setState] = useState<State | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const epoch = useRef(0);
  const path = `/dashboards/${dashboardId}/legacy-disable/v1`;
  async function read() {
    const value = await apiRequest<State>(path, {}, accessToken);
    if (value.dashboardId !== dashboardId || value.mode !== "LEGACY" || typeof value.isActive !== "boolean" || !/^[a-f0-9]{64}$/.test(value.version)) throw new Error("RESPONSE_INVALID");
    return value;
  }
  async function reload() {
    const current = epoch.current; setBusy(true); setState(null); setMessage("");
    try { const value = await read(); if (current === epoch.current) setState(value); }
    catch (error) { if (current === epoch.current && (error as { code?: string })?.code !== "DASHBOARD_LEGACY_MODE_REQUIRED") setMessage(managementError(error)); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  useEffect(() => {
    ++epoch.current; void reload();
    return () => { ++epoch.current; };
  }, [dashboardId, accessToken]);
  async function disable() {
    if (busy) return;
    const current = epoch.current; setBusy(true); setMessage("");
    try {
      const latest = await read();
      if (current !== epoch.current) return;
      setState(latest);
      if (!latest.isActive || !window.confirm("確認安全停用此 Legacy Dashboard？只會停用並撤銷裝置憑證，不修改 Query、參數、版型或核准；此操作不能重新啟用。")) return;
      await apiRequest(path, { method: "POST", body: JSON.stringify({ expectedVersion: latest.version, confirmed: true }) }, accessToken);
      if (current !== epoch.current) return;
      setState({ ...latest, isActive: false }); setMessage("Legacy Dashboard 已安全停用，裝置憑證已失效。請重新載入各區版本後轉換。");
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "transition" } }));
    } catch (error) { if (current === epoch.current) { setState(null); setMessage(managementError(error)); } }
    finally { if (current === epoch.current) setBusy(false); }
  }
  return <section aria-label="Legacy 安全停用">{!state && message && <button type="button" disabled={busy} onClick={() => void reload()}>重新載入 Legacy 停用狀態</button>}{state?.isActive && <button type="button" disabled={busy} onClick={() => void disable()}>安全停用 Legacy Dashboard（撤銷裝置憑證）</button>}
    {message && <p role="status">{message}</p>}</section>;
}
