import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ManagementListToolbar } from "../components/ManagementListToolbar";
import "./DashboardDesignerPage.css";

type DashboardRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  queryDefinitionId: number;
  queryCode: string;
  queryName: string;
  refreshSeconds: number;
  displayMode: "TABLE" | "BIG_SCREEN";
  displayTitle: string | null;
  pageSize: number;
  pageSeconds: number;
  showClock: boolean;
  showPageNumber: boolean;
  showCountdown: boolean;
  parameters: Record<string, unknown>;
  isActive: boolean;
};

type QueryDefinitionRow = {
  id: number;
  code: string;
  name: string;
  isPublished: boolean;
  isActive: boolean;
  isArchived: boolean;
};

type ReportColumn = {
  columnName: string;
  displayLabel: string;
  displayOrder: number;
  isVisible: boolean;
  alignment: "LEFT" | "CENTER" | "RIGHT";
};

type DisplayDevice = {
  id: number;
  dashboardId: number;
  deviceName: string;
  isActive: boolean;
  enforceIpRestriction: boolean;
  allowedIp: string | null;
  allowedCidr: string | null;
  expiresAtUtc: string | null;
  lastUsedAtUtc: string | null;
  createdAtUtc: string | null;
  revokedAtUtc: string | null;
};

type ManagedScreen = {
  label?: string;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary?: boolean;
};

type FixedPlaybackSetup = {
  dashboard: DashboardRow;
  deviceName: string;
  autoFullscreen: boolean;
  enforceIpRestriction: boolean;
  restriction: string;
  expiresDays: string;
  screens: ManagedScreen[];
  selectedScreenIndex: number;
  screenMode: "auto" | "manual" | "script";
  windowX: string;
  windowY: string;
  windowWidth: string;
  windowHeight: string;
};

type PreviewResult = {
  dashboard: DashboardRow;
  query: { id: number; code: string; name: string };
  reportColumns: ReportColumn[];
  result: {
    columns: { name: string; dataType?: string }[];
    rows: Record<string, unknown>[];
    rowCount: number;
    truncated: boolean;
    elapsedMs: number;
  };
};

type FormState = {
  id: number | null;
  code: string;
  name: string;
  description: string;
  queryDefinitionId: string;
  refreshSeconds: string;
  displayMode: "TABLE" | "BIG_SCREEN";
  displayTitle: string;
  pageSize: string;
  pageSeconds: string;
  showClock: boolean;
  showPageNumber: boolean;
  showCountdown: boolean;
  parametersJson: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  id: null,
  code: "",
  name: "",
  description: "",
  queryDefinitionId: "",
  refreshSeconds: "10",
  displayMode: "BIG_SCREEN",
  displayTitle: "",
  pageSize: "5",
  pageSeconds: "20",
  showClock: true,
  showPageNumber: true,
  showCountdown: true,
  parametersJson: "{}",
  isActive: true,
};

function displayValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function deviceDaysRemaining(expiresAtUtc: string | null): number | null {
  if (!expiresAtUtc) return null;
  const expires = new Date(expiresAtUtc).getTime();
  if (!Number.isFinite(expires)) return null;
  return Math.ceil((expires - Date.now()) / 86_400_000);
}

function deviceExpiryLabel(expiresAtUtc: string | null): string {
  const days = deviceDaysRemaining(expiresAtUtc);
  if (days == null) return "不過期";
  if (days < 0) return `已到期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  return `剩餘 ${days} 天`;
}

export function DashboardDesignerPage() {
  const { accessToken } = useAuth();

  function openPlayback(dashboardId: number) {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("瀏覽器封鎖了播放視窗，請允許此網站開啟新視窗後再試一次。");
      return;
    }

    const storedAuth = sessionStorage.getItem("uqp.auth");
    if (storedAuth) {
      try {
        popup.sessionStorage.setItem("uqp.auth", storedAuth);
      } catch {
        // If storage handoff fails, the login route will return to the requested playback path.
      }
    }

    popup.location.replace(`/designer/dashboards/${dashboardId}/display`);
  }
  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [queries, setQueries] = useState<QueryDefinitionRow[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewDashboardId, setPreviewDashboardId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [listStatus, setListStatus] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [listDisplayMode, setListDisplayMode] = useState<"" | "TABLE" | "BIG_SCREEN">("");
  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(20);
  const [listTotal, setListTotal] = useState(0);
  const [listTotalPages, setListTotalPages] = useState(1);
  const [deviceDashboard, setDeviceDashboard] = useState<DashboardRow | null>(null);
  const [displayDevices, setDisplayDevices] = useState<DisplayDevice[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [fixedPlaybackSetup, setFixedPlaybackSetup] = useState<FixedPlaybackSetup | null>(null);
  const [fixedPlaybackSaving, setFixedPlaybackSaving] = useState(false);
  const [issuedToken, setIssuedToken] = useState<{
    dashboardId: number;
    deviceId: number;
    deviceName: string;
    token: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(listPage),
        pageSize: String(listPageSize),
        status: listStatus,
      });
      if (listSearch) params.set("search", listSearch);
      if (listDisplayMode) params.set("displayMode", listDisplayMode);

      const [dashboardResult, queryResult] = await Promise.all([
        apiRequest<{
          dashboards: DashboardRow[];
          total: number;
          totalPages: number;
        }>(`/dashboards?${params.toString()}`, {}, accessToken),
        apiRequest<{ queryDefinitions: QueryDefinitionRow[] }>("/query-definitions", {}, accessToken),
      ]);
      setDashboards(dashboardResult.dashboards);
      setListTotal(dashboardResult.total);
      setListTotalPages(dashboardResult.totalPages);
      setQueries(queryResult.queryDefinitions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Dashboard 設定失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, listDisplayMode, listPage, listPageSize, listSearch, listStatus]);

  useEffect(() => { void load(); }, [load]);

  const usableQueries = useMemo(
    () => queries.filter((query) => query.isPublished && query.isActive && !query.isArchived),
    [queries],
  );

  const loadPreview = useCallback(async (dashboardId: number, silent = false) => {
    if (!silent) setPreviewLoading(true);
    setError("");
    try {
      const result = await apiRequest<PreviewResult>(
        `/dashboards/${dashboardId}/preview`,
        { method: "POST" },
        accessToken,
      );
      setPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dashboard 預覽失敗。");
      if (!silent) setPreview(null);
    } finally {
      if (!silent) setPreviewLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!previewDashboardId) return;

    const dashboard = dashboards.find((item) => item.id === previewDashboardId);
    if (!dashboard) return;

    const timer = window.setInterval(
      () => void loadPreview(previewDashboardId, true),
      Math.max(5, dashboard.refreshSeconds) * 1000,
    );

    return () => window.clearInterval(timer);
  }, [dashboards, loadPreview, previewDashboardId]);

  function editDashboard(item: DashboardRow) {
    setForm({
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description ?? "",
      queryDefinitionId: String(item.queryDefinitionId),
      refreshSeconds: String(item.refreshSeconds),
      displayMode: item.displayMode,
      displayTitle: item.displayTitle ?? "",
      pageSize: String(item.pageSize),
      pageSeconds: String(item.pageSeconds),
      showClock: item.showClock,
      showPageNumber: item.showPageNumber,
      showCountdown: item.showCountdown,
      parametersJson: JSON.stringify(item.parameters ?? {}, null, 2),
      isActive: item.isActive,
    });
    setNotice("");
    setError("");
  }

  function newDashboard() {
    setForm(emptyForm);
    setNotice("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      let parameters: Record<string, unknown>;
      try {
        const parsed = JSON.parse(form.parametersJson || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("NOT_OBJECT");
        }
        parameters = parsed;
      } catch {
        setError("預設參數必須是 JSON Object，例如 { \"ROOM_CODE\": \"OR01\" }。");
        return;
      }

      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        queryDefinitionId: Number(form.queryDefinitionId),
        refreshSeconds: Number(form.refreshSeconds),
        displayMode: form.displayMode,
        displayTitle: form.displayTitle.trim() || null,
        pageSize: Number(form.pageSize),
        pageSeconds: Number(form.pageSeconds),
        showClock: form.showClock,
        showPageNumber: form.showPageNumber,
        showCountdown: form.showCountdown,
        parameters,
        isActive: form.isActive,
      };

      if (form.id) {
        await apiRequest(`/dashboards/${form.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        }, accessToken);
        setNotice("Dashboard 已更新。");
      } else {
        await apiRequest("/dashboards", {
          method: "POST",
          body: JSON.stringify(payload),
        }, accessToken);
        setNotice("Dashboard 已建立。");
      }

      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Dashboard 失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: DashboardRow) {
    if (!window.confirm(`確定刪除 Dashboard「${item.name}」？`)) return;
    setError("");
    setNotice("");
    try {
      await apiRequest(`/dashboards/${item.id}`, { method: "DELETE" }, accessToken);
      if (previewDashboardId === item.id) {
        setPreviewDashboardId(null);
        setPreview(null);
      }
      setNotice("Dashboard 已刪除。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除 Dashboard 失敗。");
    }
  }

  async function startPreview(item: DashboardRow) {
    setPreviewDashboardId(item.id);
    await loadPreview(item.id);
  }


  async function loadDevices(item: DashboardRow) {
    setDeviceDashboard(item);
    setDeviceLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ devices: DisplayDevice[] }>(
        `/dashboards/${item.id}/devices`,
        {},
        accessToken,
      );
      setDisplayDevices(result.devices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入固定播放裝置失敗。");
    } finally {
      setDeviceLoading(false);
    }
  }

  async function openFixedPlaybackSetup(item: DashboardRow) {
    setError("");
    setNotice("");

    let screens: ManagedScreen[] = [];
    try {
      const windowWithScreens = window as typeof window & {
        getScreenDetails?: () => Promise<{ screens: ManagedScreen[] }>;
      };
      if (windowWithScreens.getScreenDetails) {
        const details = await windowWithScreens.getScreenDetails();
        screens = details.screens ?? [];
      }
    } catch {
      screens = [];
    }

    setFixedPlaybackSetup({
      dashboard: item,
      deviceName: "",
      autoFullscreen: true,
      enforceIpRestriction: false,
      restriction: "",
      expiresDays: "365",
      screens,
      selectedScreenIndex: 0,
      screenMode: "auto",
      windowX: "1920",
      windowY: "0",
      windowWidth: "1920",
      windowHeight: "1080",
    });
  }

  function downloadWindowsLauncher() {
    const setup = fixedPlaybackSetup;
    if (!setup) return;
    const coords = [setup.windowX, setup.windowY, setup.windowWidth, setup.windowHeight].map(Number);
    if (coords.some((value) => !Number.isSafeInteger(value)) || coords[2] < 200 || coords[3] < 200) {
      setError("請輸入有效的整數座標，視窗寬度與高度至少 200。");
      return;
    }
    const [x, y, width, height] = coords;
    const url = new URL(`/display/dashboards/${setup.dashboard.id}`, window.location.origin).href;
    const script = [
      "@echo off",
      "rem Dashboard fixed playback launcher - no Device Token stored in this file",
      "rem First provision the Device Token in this browser profile on the playback PC.",
      "rem Edge may reuse an existing window and ignore position hints.",
      'start "" msedge.exe --new-window --window-position=' + x + ',' + y
        + ' --window-size=' + width + ',' + height + ' "' + url + '"',
      "",
    ].join("\r\n");
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `dashboard-${setup.dashboard.id}-windows-launcher.bat`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setNotice("已產生 Windows 啟動腳本；請先在播放電腦同一瀏覽器設定 Device Token。");
  }

  async function createFixedPlaybackFromSetup() {
    const setup = fixedPlaybackSetup;
    if (!setup) return;

    const deviceName = setup.deviceName.trim();
    if (!deviceName) {
      setError("請輸入顯示裝置名稱。");
      return;
    }

    const expiresDays = Number(setup.expiresDays);
    if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 3650) {
      setError("有效期限必須為 1～3650 天。");
      return;
    }

    const restriction = setup.restriction.trim();
    if (setup.enforceIpRestriction && !restriction) {
      setError("啟用來源 IP 限制時，必須輸入允許 IP 或 IPv4 CIDR。");
      return;
    }

    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("瀏覽器封鎖了播放視窗，請允許此網站開啟新視窗後再試一次。");
      return;
    }

    setFixedPlaybackSaving(true);
    setError("");

    try {
      const selectedScreen = setup.screenMode === "auto" ? setup.screens[setup.selectedScreenIndex] ?? null : null;
      if (selectedScreen) {
        popup.moveTo(selectedScreen.availLeft, selectedScreen.availTop);
        popup.resizeTo(selectedScreen.availWidth, selectedScreen.availHeight);
      }

      const allowedCidr = setup.enforceIpRestriction && restriction.includes("/") ? restriction : null;
      const allowedIp = setup.enforceIpRestriction && !restriction.includes("/") ? restriction : null;

      const result = await apiRequest<{ device: DisplayDevice; token: string }>(
        `/dashboards/${setup.dashboard.id}/devices`,
        {
          method: "POST",
          body: JSON.stringify({
            deviceName,
            expiresDays,
            enforceIpRestriction: setup.enforceIpRestriction,
            allowedIp,
            allowedCidr,
          }),
        },
        accessToken,
      );

      popup.localStorage.setItem(`uqp.dashboard.device.${setup.dashboard.id}`, result.token);
      popup.localStorage.setItem(
        `uqp.dashboard.display-settings.${setup.dashboard.id}`,
        JSON.stringify({
          autoFullscreen: setup.autoFullscreen,
          screenIndex: selectedScreen ? setup.selectedScreenIndex : null,
          screenLabel: selectedScreen?.label ?? null,
          screenBounds: selectedScreen
            ? {
                left: selectedScreen.availLeft,
                top: selectedScreen.availTop,
                width: selectedScreen.availWidth,
                height: selectedScreen.availHeight,
              }
            : null,
        }),
      );

      popup.location.replace(
        `/display/dashboards/${setup.dashboard.id}${setup.autoFullscreen ? "?autoFullscreen=1" : ""}`,
      );

      setNotice(`已建立固定播放裝置「${result.device.deviceName}」。`);
      setFixedPlaybackSetup(null);
      if (deviceDashboard?.id === setup.dashboard.id) {
        await loadDevices(setup.dashboard);
      }
    } catch (e) {
      popup.close();
      setError(e instanceof Error ? e.message : "建立固定播放裝置失敗。");
    } finally {
      setFixedPlaybackSaving(false);
    }
  }

  async function editDevice(device: DisplayDevice) {
    if (!deviceDashboard) return;

    const deviceName = window.prompt("裝置名稱", device.deviceName);
    if (!deviceName?.trim()) return;

    const enforceIpRestriction = window.confirm(
      device.enforceIpRestriction
        ? "此裝置目前已啟用來源 IP 限制。\n\n按「確定」保留 IP 限制；按「取消」則關閉 IP 限制。"
        : "是否啟用此裝置的來源 IP 限制？",
    );

    let allowedIp: string | null = null;
    let allowedCidr: string | null = null;

    if (enforceIpRestriction) {
      const currentRestriction = device.allowedIp ?? device.allowedCidr ?? "";
      const restriction = window.prompt(
        "請輸入允許的來源 IP 或 IPv4 CIDR。\n\n單一 IP 範例：10.145.143.50\n網段範例：10.145.143.0/24",
        currentRestriction,
      );

      if (!restriction?.trim()) {
        setError("已取消修改：啟用來源 IP 限制時必須輸入允許的 IP 或 CIDR。");
        return;
      }

      if (restriction.includes("/")) {
        allowedCidr = restriction.trim();
      } else {
        allowedIp = restriction.trim();
      }
    }

    setError("");
    try {
      await apiRequest(
        `/dashboards/${deviceDashboard.id}/devices/${device.id}/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({
            deviceName: deviceName.trim(),
            enforceIpRestriction,
            allowedIp,
            allowedCidr,
          }),
        },
        accessToken,
      );
      setNotice(`顯示裝置「${deviceName.trim()}」設定已更新，原 Device Token 繼續有效。`);
      await loadDevices(deviceDashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新顯示裝置設定失敗。");
    }
  }

  async function reissueDeviceToken(device: DisplayDevice) {
    if (!deviceDashboard) return;
    if (!window.confirm(
      `確定重新核發顯示裝置「${device.deviceName}」的 Token？\n\n舊 Token 會立即失效。若原看板仍在使用舊 Token，將停止播放，直到套用新 Token。`,
    )) return;

    setError("");
    try {
      const result = await apiRequest<{ device: DisplayDevice; token: string }>(
        `/dashboards/${deviceDashboard.id}/devices/${device.id}/reissue-token`,
        { method: "POST" },
        accessToken,
      );

      setIssuedToken({
        dashboardId: deviceDashboard.id,
        deviceId: device.id,
        deviceName: result.device.deviceName,
        token: result.token,
      });
      setNotice(`已重新核發「${result.device.deviceName}」的 Device Token。新 Token 只會在此畫面顯示一次。`);
      await loadDevices(deviceDashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新核發 Device Token 失敗。");
    }
  }

  async function copyIssuedToken() {
    if (!issuedToken) return;
    try {
      await navigator.clipboard.writeText(issuedToken.token);
      setNotice("Device Token 已複製到剪貼簿。");
    } catch {
      setError("瀏覽器無法使用剪貼簿，請手動選取 Token 複製。");
    }
  }

  function applyIssuedTokenToThisBrowser() {
    if (!issuedToken) return;
    localStorage.setItem(
      `uqp.dashboard.device.${issuedToken.dashboardId}`,
      issuedToken.token,
    );
    setNotice(
      `已將「${issuedToken.deviceName}」的新 Token 套用到目前瀏覽器。此電腦可使用該 Dashboard 的固定播放模式。`,
    );
  }

  async function renewDevice(device: DisplayDevice) {
    if (!deviceDashboard) return;
    if (!window.confirm(`確定將顯示裝置「${device.deviceName}」延長 365 天？\n\n原本 Device Token 不會更換，看板端不需要重新設定。`)) return;

    setError("");
    try {
      await apiRequest(
        `/dashboards/${deviceDashboard.id}/devices/${device.id}/renew`,
        {
          method: "PATCH",
          body: JSON.stringify({ days: 365 }),
        },
        accessToken,
      );
      setNotice(`顯示裝置「${device.deviceName}」已延長 365 天，原 Device Token 繼續有效。`);
      await loadDevices(deviceDashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "延長顯示裝置期限失敗。");
    }
  }

  async function revokeDevice(device: DisplayDevice) {
    if (!deviceDashboard) return;
    if (!window.confirm(`確定停用顯示裝置「${device.deviceName}」？停用後該螢幕下次更新資料時會停止播放。`)) return;

    setError("");
    try {
      await apiRequest(
        `/dashboards/${deviceDashboard.id}/devices/${device.id}`,
        { method: "DELETE" },
        accessToken,
      );
      setNotice(`顯示裝置「${device.deviceName}」已停用。`);
      await loadDevices(deviceDashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "停用顯示裝置失敗。");
    }
  }

  const previewColumns = useMemo(() => {
    if (!preview) return [];

    const resultNames = new Set(preview.result.columns.map((column) => column.name));
    const configured = preview.reportColumns
      .filter((column) => column.isVisible && resultNames.has(column.columnName))
      .sort((a, b) => a.displayOrder - b.displayOrder);

    if (preview.reportColumns.length > 0) return configured;

    return preview.result.columns.map((column, index) => ({
      columnName: column.name,
      displayLabel: column.name,
      displayOrder: index,
      isVisible: true,
      alignment: "LEFT" as const,
    }));
  }, [preview]);

  return (
    <main className="page-shell dashboard-designer-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Dashboard Designer</p>
          <h1>資料顯示儀表板</h1>
          <p className="subtitle">建立 Dashboard、設定預設參數、資料更新秒數與大螢幕自動換頁。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {loading && <section className="notice">載入中…</section>}
      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      {!loading && (
        <>
          <section className="dashboard-editor-card">
            <div className="dashboard-editor-heading">
              <h2>{form.id ? "編輯 Dashboard" : "新增 Dashboard"}</h2>
              {form.id && (
                <button className="secondary-button" type="button" onClick={newDashboard}>新增另一個</button>
              )}
            </div>

            <form onSubmit={save} className="dashboard-editor-form">
              <label>
                <span>代碼</span>
                <input
                  value={form.code}
                  placeholder="例如 OR01_STATUS"
                  disabled={Boolean(form.id)}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                />
              </label>

              <label>
                <span>名稱</span>
                <input
                  value={form.name}
                  placeholder="例如 手術室 1 狀態"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>

              <label className="wide">
                <span>說明</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>

              <label>
                <span>資料 Query</span>
                <select
                  value={form.queryDefinitionId}
                  onChange={(e) => setForm({ ...form, queryDefinitionId: e.target.value })}
                >
                  <option value="">請選擇已發佈 Query</option>
                  {usableQueries.map((query) => (
                    <option key={query.id} value={query.id}>
                      {query.name} ({query.code})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>資料更新秒數</span>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={form.refreshSeconds}
                  onChange={(e) => setForm({ ...form, refreshSeconds: e.target.value })}
                />
                <small>每個 Dashboard 可獨立設定，5～3600 秒。</small>
              </label>

              <label>
                <span>顯示模式</span>
                <select
                  value={form.displayMode}
                  onChange={(e) => setForm({ ...form, displayMode: e.target.value as "TABLE" | "BIG_SCREEN" })}
                >
                  <option value="BIG_SCREEN">大螢幕看板</option>
                  <option value="TABLE">一般表格</option>
                </select>
              </label>

              <label className="wide">
                <span>播放標題</span>
                <input
                  value={form.displayTitle}
                  placeholder="例如 手術病患動態；留白則使用 Dashboard 名稱"
                  onChange={(e) => setForm({ ...form, displayTitle: e.target.value })}
                />
              </label>

              <label>
                <span>每頁筆數</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.pageSize}
                  onChange={(e) => setForm({ ...form, pageSize: e.target.value })}
                />
              </label>

              <label>
                <span>換頁秒數</span>
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={form.pageSeconds}
                  onChange={(e) => setForm({ ...form, pageSeconds: e.target.value })}
                />
                <small>每個 Dashboard 可獨立設定，與資料更新秒數分開。</small>
              </label>

              <div className="dashboard-display-options wide">
                <label>
                  <input
                    type="checkbox"
                    checked={form.showClock}
                    onChange={(e) => setForm({ ...form, showClock: e.target.checked })}
                  />
                  <span>顯示系統時間</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.showPageNumber}
                    onChange={(e) => setForm({ ...form, showPageNumber: e.target.checked })}
                  />
                  <span>顯示頁碼</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.showCountdown}
                    onChange={(e) => setForm({ ...form, showCountdown: e.target.checked })}
                  />
                  <span>顯示換頁倒數</span>
                </label>
              </div>

              <label className="wide">
                <span>預設參數 JSON</span>
                <textarea
                  rows={5}
                  value={form.parametersJson}
                  spellCheck={false}
                  placeholder={'{\n  "ROOM_CODE": "OR01"\n}'}
                  onChange={(e) => setForm({ ...form, parametersJson: e.target.value })}
                />
                <small>第一階段先使用 JSON；後續會改為參數預設表單並支援 Display Profile 覆寫。</small>
              </label>

              <label className="dashboard-active-field">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span>啟用 Dashboard</span>
              </label>

              <div className="dashboard-form-actions">
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "儲存中…" : form.id ? "儲存修改" : "建立 Dashboard"}
                </button>
                {form.id && (
                  <button className="secondary-button" type="button" onClick={newDashboard}>取消編輯</button>
                )}
              </div>
            </form>
          </section>

          <section className="dashboard-list-card">
            <h2>Dashboard 清單</h2>
            <ManagementListToolbar
              search={listSearch}
              onSearch={(value) => { setListSearch(value); setListPage(1); }}
              page={listPage}
              pageSize={listPageSize}
              total={listTotal}
              totalPages={listTotalPages}
              onPageChange={setListPage}
              onPageSizeChange={(value) => { setListPageSize(value); setListPage(1); }}
              filters={
                <>
                  <label>
                    <span>狀態</span>
                    <select
                      value={listStatus}
                      onChange={(event) => {
                        setListStatus(event.target.value as "ACTIVE" | "INACTIVE" | "ALL");
                        setListPage(1);
                      }}
                    >
                      <option value="ACTIVE">啟用</option>
                      <option value="INACTIVE">停用</option>
                      <option value="ALL">全部</option>
                    </select>
                  </label>
                  <label>
                    <span>模式</span>
                    <select
                      value={listDisplayMode}
                      onChange={(event) => {
                        setListDisplayMode(event.target.value as "" | "TABLE" | "BIG_SCREEN");
                        setListPage(1);
                      }}
                    >
                      <option value="">全部</option>
                      <option value="BIG_SCREEN">大螢幕</option>
                      <option value="TABLE">一般表格</option>
                    </select>
                  </label>
                </>
              }
            />
            <div className="dashboard-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>代碼</th>
                    <th>名稱</th>
                    <th>Query</th>
                    <th>資料更新</th>
                    <th>換頁</th>
                    <th>模式</th>
                    <th>狀態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboards.map((item) => (
                    <tr key={item.id}>
                      <td>{item.code}</td>
                      <td>{item.name}</td>
                      <td>{item.queryName}<small>{item.queryCode}</small></td>
                      <td>{item.refreshSeconds} 秒</td>
                      <td>{item.pageSeconds} 秒 / {item.pageSize} 筆</td>
                      <td>{item.displayMode === "BIG_SCREEN" ? "大螢幕" : "表格"}</td>
                      <td>{item.isActive ? "啟用" : "停用"}</td>
                      <td className="actions">
                        <button className="secondary-button" type="button" onClick={() => editDashboard(item)}>編輯</button>
                        <button className="secondary-button" type="button" onClick={() => void startPreview(item)}>
                          預覽
                        </button>
                        <Link
                          className="secondary-button link-button"
                          to={`/designer/dashboards/${item.id}/layout`}
                        >
                          版面設計
                        </Link>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => openPlayback(item.id)}
                        >
                          播放
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={!item.isActive}
                          onClick={() => void openFixedPlaybackSetup(item)}
                        >
                          固定播放
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void loadDevices(item)}
                        >
                          裝置管理
                        </button>
                        <button className="danger-button" type="button" onClick={() => void remove(item)}>刪除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dashboards.length === 0 && <div className="empty-state">尚未建立 Dashboard。</div>}
          </section>

          {fixedPlaybackSetup && (
            <div className="fixed-playback-modal-backdrop" role="presentation">
              <section className="fixed-playback-modal" role="dialog" aria-modal="true" aria-labelledby="fixed-playback-title">
                <div className="fixed-playback-modal-heading">
                  <div>
                    <p className="eyebrow">Fixed Display Device</p>
                    <h2 id="fixed-playback-title">建立固定播放裝置</h2>
                    <p>{fixedPlaybackSetup.dashboard.name}</p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={fixedPlaybackSaving}
                    onClick={() => setFixedPlaybackSetup(null)}
                  >
                    關閉
                  </button>
                </div>

                <div className="fixed-playback-form">
                  <label>
                    <span>裝置名稱</span>
                    <input
                      autoFocus
                      value={fixedPlaybackSetup.deviceName}
                      placeholder="例如：3F 手術室大螢幕"
                      onChange={(e) => setFixedPlaybackSetup({ ...fixedPlaybackSetup, deviceName: e.target.value })}
                    />
                  </label>

                  <label>
                    <span>螢幕定位方式</span>
                    <select
                      value={fixedPlaybackSetup.screenMode}
                      onChange={(e) => setFixedPlaybackSetup({
                        ...fixedPlaybackSetup,
                        screenMode: e.target.value as FixedPlaybackSetup["screenMode"],
                      })}
                    >
                      <option value="auto">瀏覽器自動偵測</option>
                      <option value="manual">手動開啟（不指定螢幕）</option>
                      <option value="script">Windows 啟動腳本（指定座標）</option>
                    </select>
                  </label>

                  {fixedPlaybackSetup.screenMode === "script" && (
                    <>
                      {(["windowX", "windowY", "windowWidth", "windowHeight"] as const).map((field) => (
                        <label key={field}>
                          <span>{({ windowX: "X 座標", windowY: "Y 座標", windowWidth: "寬度", windowHeight: "高度" })[field]}</span>
                          <input
                            type="number"
                            value={fixedPlaybackSetup[field]}
                            onChange={(e) => setFixedPlaybackSetup({ ...fixedPlaybackSetup, [field]: e.target.value })}
                          />
                        </label>
                      ))}
                      <p className="fixed-playback-hint">
                        下載的 .bat 不包含 Token。請先在播放電腦的同一 Edge 使用者設定檔啟用 Device Token，
                        再執行腳本。視窗定位是 Edge 啟動提示，不保證每次生效。
                      </p>
                    </>
                  )}
                  {fixedPlaybackSetup.screenMode === "auto" && <label>
                    <span>播放螢幕</span>
                    <select
                      value={fixedPlaybackSetup.selectedScreenIndex}
                      disabled={fixedPlaybackSetup.screens.length === 0}
                      onChange={(e) => setFixedPlaybackSetup({
                        ...fixedPlaybackSetup,
                        selectedScreenIndex: Number(e.target.value),
                      })}
                    >
                      {fixedPlaybackSetup.screens.length === 0 ? (
                        <option value={0}>瀏覽器未提供多螢幕清單，使用目前螢幕</option>
                      ) : fixedPlaybackSetup.screens.map((screen, index) => (
                        <option key={index} value={index}>
                          {screen.label || `螢幕 ${index + 1}`}－{screen.availWidth}×{screen.availHeight}
                          {screen.isPrimary ? "（主螢幕）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>}

                  <label>
                    <span>有效期限（天）</span>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={fixedPlaybackSetup.expiresDays}
                      onChange={(e) => setFixedPlaybackSetup({ ...fixedPlaybackSetup, expiresDays: e.target.value })}
                    />
                  </label>

                  <label className="fixed-playback-check">
                    <input
                      type="checkbox"
                      checked={fixedPlaybackSetup.autoFullscreen}
                      onChange={(e) => setFixedPlaybackSetup({ ...fixedPlaybackSetup, autoFullscreen: e.target.checked })}
                    />
                    <span>全螢幕優先</span>
                  </label>

                  <label className="fixed-playback-check">
                    <input
                      type="checkbox"
                      checked={fixedPlaybackSetup.enforceIpRestriction}
                      onChange={(e) => setFixedPlaybackSetup({
                        ...fixedPlaybackSetup,
                        enforceIpRestriction: e.target.checked,
                      })}
                    />
                    <span>限制來源 IP</span>
                  </label>

                  {fixedPlaybackSetup.enforceIpRestriction && (
                    <label>
                      <span>允許 IP / IPv4 CIDR</span>
                      <input
                        value={fixedPlaybackSetup.restriction}
                        placeholder="例如 10.145.143.29 或 10.145.143.0/24"
                        onChange={(e) => setFixedPlaybackSetup({ ...fixedPlaybackSetup, restriction: e.target.value })}
                      />
                    </label>
                  )}
                </div>

                <div className="fixed-playback-modal-actions">
                  {fixedPlaybackSetup.screenMode === "script" && (
                    <button className="secondary-button" type="button" onClick={downloadWindowsLauncher}>
                      下載 Windows 啟動腳本
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={fixedPlaybackSaving}
                    onClick={() => setFixedPlaybackSetup(null)}
                  >
                    取消
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={fixedPlaybackSaving}
                    onClick={() => void createFixedPlaybackFromSetup()}
                  >
                    {fixedPlaybackSaving ? "建立中…" : "建立固定播放"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {deviceDashboard && (
            <section className="dashboard-device-card">
              <div className="dashboard-preview-heading">
                <div>
                  <p className="eyebrow">Display Devices</p>
                  <h2>{deviceDashboard.name}－固定播放裝置</h2>
                  <p>固定播放使用獨立裝置憑證，不受一般 8 小時登入 JWT 影響。</p>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setDeviceDashboard(null);
                    setDisplayDevices([]);
                    setIssuedToken(null);
                  }}
                >
                  關閉
                </button>
              </div>

              {issuedToken && issuedToken.dashboardId === deviceDashboard.id && (
                <div className="device-token-once">
                  <div>
                    <strong>新 Device Token（只顯示一次）</strong>
                    <p>
                      重新離開此頁後無法從 Server 查回原始 Token。若尚未套用到播放電腦，請先複製保存。
                    </p>
                  </div>
                  <code>{issuedToken.token}</code>
                  <div className="actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void copyIssuedToken()}
                    >
                      複製 Token
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={applyIssuedTokenToThisBrowser}
                    >
                      在此電腦啟用
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setIssuedToken(null)}
                    >
                      關閉
                    </button>
                  </div>
                </div>
              )}

              {deviceLoading ? (
                <div className="notice">載入裝置中…</div>
              ) : displayDevices.length === 0 ? (
                <div className="empty-state">尚未建立固定播放裝置。</div>
              ) : (
                <div className="dashboard-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>裝置名稱</th>
                        <th>狀態</th>
                        <th>來源限制</th>
                        <th>最後使用</th>
                        <th>到期時間</th>
                        <th>剩餘</th>
                        <th>建立時間</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayDevices.map((device) => (
                        <tr key={device.id}>
                          <td>{device.deviceName}</td>
                          <td>{device.isActive ? "啟用" : "已停用"}</td>
                          <td>
                            {device.enforceIpRestriction
                              ? device.allowedIp ?? device.allowedCidr ?? "已啟用"
                              : "不限"}
                          </td>
                          <td>{device.lastUsedAtUtc ? new Date(device.lastUsedAtUtc).toLocaleString() : "尚未使用"}</td>
                          <td>{device.expiresAtUtc ? new Date(device.expiresAtUtc).toLocaleString() : "不過期"}</td>
                          <td>
                            <span
                              className={`device-expiry-badge ${
                                (deviceDaysRemaining(device.expiresAtUtc) ?? 9999) <= 7
                                  ? "danger"
                                  : (deviceDaysRemaining(device.expiresAtUtc) ?? 9999) <= 30
                                    ? "warning"
                                    : "normal"
                              }`}
                            >
                              {deviceExpiryLabel(device.expiresAtUtc)}
                            </span>
                          </td>
                          <td>{device.createdAtUtc ? new Date(device.createdAtUtc).toLocaleString() : ""}</td>
                          <td className="actions">
                            {device.isActive && (
                              <>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => void editDevice(device)}
                                >
                                  編輯
                                </button>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => void reissueDeviceToken(device)}
                                >
                                  重新核發 Token
                                </button>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => void renewDevice(device)}
                                >
                                  延長 365 天
                                </button>
                                <button
                                  className="danger-button"
                                  type="button"
                                  onClick={() => void revokeDevice(device)}
                                >
                                  停用
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {previewDashboardId && (
            <section className="dashboard-preview-card">
              <div className="dashboard-preview-heading">
                <div>
                  <p className="eyebrow">Live Preview</p>
                  <h2>{preview?.dashboard.name ?? "Dashboard 預覽"}</h2>
                  {preview && (
                    <p>
                      {preview.result.rowCount} 筆 · {preview.result.elapsedMs} ms ·
                      每 {preview.dashboard.refreshSeconds} 秒自動更新
                    </p>
                  )}
                </div>
                <div className="actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={previewLoading}
                    onClick={() => void loadPreview(previewDashboardId)}
                  >
                    {previewLoading ? "更新中…" : "立即更新"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setPreviewDashboardId(null);
                      setPreview(null);
                    }}
                  >
                    關閉預覽
                  </button>
                </div>
              </div>

              {preview && (
                <div className="dashboard-preview-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {previewColumns.map((column) => (
                          <th key={column.columnName}>{column.displayLabel}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {previewColumns.map((column) => (
                            <td
                              key={column.columnName}
                              style={{
                                textAlign: column.alignment.toLowerCase() as "left" | "center" | "right",
                              }}
                            >
                              {displayValue(row[column.columnName])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.result.rows.length === 0 && (
                    <div className="empty-state">目前沒有資料。</div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
