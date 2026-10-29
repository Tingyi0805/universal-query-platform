import { deviceExpiry } from "../dashboard/deviceExpiry";
import { flushSync } from "react-dom";
import { SecurityManagementLinks } from "../components/SecurityManagementLinks";
import { sourcePreviewFailure } from "../dashboard/dataSettings";
import { dashboardFullscreenActive, dashboardFullscreenSupported, requestDashboardFullscreen } from "../dashboard/fullscreen";
import { previewAuthorizationFailed, type QuerySourceConfiguration } from "../dashboard/querySourceManagement";
import { formatDashboardValue } from "../dashboard/displayFormat";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { readDashboardToken,rememberDashboardToken,forgetDashboardToken,requestDashboardTokenHandoff, dashboardHandoffNonce } from "../security/dashboardToken";
import { apiRequest } from "../api/client";
import { startSourcePlayback, retainSourceColumns } from "../dashboard/sourcePlayback";
import { useAuth } from "../auth/AuthContext";
import "./DashboardDisplayPage.css";

type DashboardRow = {
  id: number;
  code: string;
  name: string;
  refreshSeconds: number;
  pageSize: number;
  pageSeconds: number;
  parameters: Record<string, unknown>;
};

type ReportColumn = {
  columnName: string;
  displayLabel: string;
  displayOrder: number;
  isVisible: boolean;
  alignment: "LEFT" | "CENTER" | "RIGHT";
};

type PreviewResult = {
  page?: number;
  totalPages?: number;
  totalRows?: number;
  snapshotId?: string;
  snapshotExpiresAt?: number;
  dashboard: DashboardRow;
  reportColumns: ReportColumn[];
  result: {
    columns: { name: string }[];
    rows: Record<string, unknown>[];
  };
};

type LayoutWidget = {
  id: number;
  profileId: number;
  widgetType: "TEXT" | "PARAMETER" | "FIELD" | "CLOCK" | "PAGE_INFO" | "COUNTDOWN" | "TABLE" | "CONTAINER";
  title: string | null;
  sourceKey: string | null;
  staticText: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  alignment: "LEFT" | "CENTER" | "RIGHT";
  config: Record<string, unknown>;
  sortOrder: number;
};

type LayoutProfile = {
  id: number;
  dashboardId: number;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  isDefault: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
  widgets: LayoutWidget[];
};


function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function configNumber(config: Record<string, unknown>, key: string, fallback: number) {
  const value = Number(config[key]);
  return Number.isFinite(value) ? value : fallback;
}

function configText(config: Record<string, unknown>, key: string, fallback: string) {
  const value = config[key];
  return typeof value === "string" && value ? value : fallback;
}

function widgetStyle(widget: LayoutWidget): CSSProperties {
  const opacity = Math.max(0, Math.min(100, configNumber(widget.config, "backgroundOpacity", 100))) / 100;
  const bg = configText(widget.config, "backgroundColor", "#ffffff");
  const hex = bg.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const backgroundColor = /^#[0-9a-fA-F]{6}$/.test(bg)
    ? `rgba(${r}, ${g}, ${b}, ${opacity})`
    : bg;

  return {
    color: configText(widget.config, "textColor", "#172033"),
    backgroundColor,
    fontFamily: configText(widget.config, "fontFamily", "system-ui"),
    fontWeight: configNumber(widget.config, "fontWeight", 700),
    borderColor: configText(widget.config, "borderColor", "transparent"),
    borderWidth: configNumber(widget.config, "borderWidth", 0),
    borderStyle: "solid",
    borderRadius: configNumber(widget.config, "borderRadius", 0),
    padding: configNumber(widget.config, "padding", 0),
  };
}

export function DashboardDisplayPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const dashboardId = Number(id);
  const requestedProfileId = Number(searchParams.get("profileId"));
  const previewKey = searchParams.get("previewKey");
  const autoFullscreenRequested = searchParams.get("autoFullscreen") === "1";
  const queryPreview = searchParams.get("queryPreview") === "1";
  const [previewAuthorized,setPreviewAuthorized] = useState(true);
  const deviceMode = window.location.pathname.startsWith("/display/dashboards/");
  const transportBlocked = deviceMode && window.location.protocol !== "https:";
  const [deviceToken, setDeviceToken] = useState<string | null>(() => deviceMode && !transportBlocked && !searchParams.has("deviceId") ? readDashboardToken(dashboardId) : null);
  const intendedDeviceId = Number(searchParams.get("deviceId"));
  const persistentCapable = deviceMode && window.location.protocol === "https:" && Number.isSafeInteger(intendedDeviceId) && intendedDeviceId > 0;
  const [restoringDevice,setRestoringDevice] = useState(false);
  const [persistDevice, setPersistDevice] = useState(persistentCapable);
  const cookieSession = deviceToken === "COOKIE_SESSION";
  const deviceHeaders: Record<string,string> = cookieSession ? {"X-UQP-Kiosk":"1", "X-UQP-Device-Id":String(intendedDeviceId)} : {"X-Dashboard-Device-Token":deviceToken ?? "", ...(Number.isSafeInteger(intendedDeviceId) && intendedDeviceId>0 ? {"X-UQP-Expected-Device-Id":String(intendedDeviceId)} : {})};
  const [deviceExpiryInfo,setDeviceExpiryInfo]=useState<{expiresAtUtc:string|null;offset:number}|null>(null);
  const deviceExpiryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const deviceLeaseDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activationInput, setActivationInput] = useState("");
  const [activationBusy, setActivationBusy] = useState(false);
  const activationAttempt = useRef(0);
  const [activationError, setActivationError] = useState("");
  const [activationRequired, setActivationRequired] = useState(() => deviceMode && (transportBlocked || searchParams.has("deviceId") || !readDashboardToken(dashboardId)));
  const handoffRequestId = useRef(dashboardHandoffNonce());
  useEffect(()=>{
    if (transportBlocked) { forgetDashboardToken(dashboardId); return; }
    if (!deviceMode || deviceToken || readDashboardToken(dashboardId)) return;
    // Keep one document nonce across StrictMode effect setup/cleanup replay.
    if (!window.opener && searchParams.get("handoff") !== "1") return;
    return requestDashboardTokenHandoff(dashboardId, token => {
      setActivationError(""); setDeviceToken(token); setActivationRequired(false);
    }, () => setActivationError("安全交接未完成或已逾時。請保持管理頁開啟，重新核發並從管理頁開啟播放。"), handoffRequestId.current);
  },[dashboardId,deviceMode,deviceToken,transportBlocked]);
  const { accessToken } = useAuth();
  const userRoute = !deviceMode && !queryPreview && !window.location.pathname.startsWith("/designer/");
  const [userMode, setUserMode] = useState<"LEGACY" | "QUERY_ONLY" | null>(null);
  const userSourceExpiry = useRef(new Map<string, number>());
  const userAuthorizationExpiry = useRef<number | null>(null);
  const userSecurityVersion = useRef<string | null>(null);
  const [userSession, setUserSession] = useState<string | null>(null);
  const serverPaged = deviceMode || queryPreview || userMode === "QUERY_ONLY";

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const latestDataRequest = useRef(0);
  const latestLayoutRequest = useRef(0);
  const pageSnapshotId = useRef<string | null>(null);
  const pageSnapshotCreatedAt = useRef(0);
  const lastVisibleColumns = useRef<ReportColumn[]>([]);
  const [profiles, setProfiles] = useState<LayoutProfile[]>([]);
  type SupplementalPage = { snapshotExpiresAt?: number; sourceKey: string; refreshSeconds: number; pageSeconds: number; pageSize: number; snapshotId: string; page: number;
    totalPages: number; result: { columns: { name: string }[]; rows: Record<string, unknown>[] } };
  const [supplementalPages, setSupplementalPages] = useState<Record<string, SupplementalPage>>({});
  const [supplementalErrors, setSupplementalErrors] = useState<Record<string, string>>({});
  const supplementalRequestGeneration = useRef(0);

  const [error, setError] = useState("");
  const [dataWarning, setDataWarning] = useState("");
  const [layoutWarning, setLayoutWarning] = useState("");
  const [layoutRetryCount, setLayoutRetryCount] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [retryDelaySeconds, setRetryDelaySeconds] = useState(5);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [page, setPage] = useState(1);
  const [snapshotReloadKey, setSnapshotReloadKey] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [now, setNow] = useState(new Date());
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [fullscreenNeedsClick, setFullscreenNeedsClick] = useState(false);
  const [fullscreenActive,setFullscreenActive]=useState(()=>dashboardFullscreenActive(document));
  const fullscreenSupported=dashboardFullscreenSupported(document);

  const clearDevicePlayback = useCallback((message: string) => {
    if (deviceLeaseDeadline.current !== null) {clearTimeout(deviceLeaseDeadline.current);deviceLeaseDeadline.current=null;}
    if(deviceExpiryTimer.current!==null)clearTimeout(deviceExpiryTimer.current);setDeviceExpiryInfo(null);
    ++latestDataRequest.current; ++latestLayoutRequest.current; ++supplementalRequestGeneration.current;
    pageSnapshotId.current = null; pageSnapshotCreatedAt.current = 0; lastVisibleColumns.current = [];
    forgetDashboardToken(dashboardId); setDeviceToken(null); setActivationRequired(true);
    setPreview(null); setProfiles([]); setSupplementalPages({}); setSupplementalErrors({}); setCountdown(0);
    setActivationInput(""); setActivationError(message);
  }, [dashboardId]);
  function applyDeviceAuthorization(value?:{expiresAtUtc:string|null;serverNowUtc:string}) {
    if(value===undefined)return; // Historical layout fixtures/clients have no lease metadata.
    if(!value || typeof value.serverNowUtc!=="string" || value.expiresAtUtc!==null && typeof value.expiresAtUtc!=="string")throw Object.assign(new Error("DEVICE_EXPIRY_INVALID"),{code:"DEVICE_EXPIRY_INVALID"});
    const serverNow=Date.parse(value.serverNowUtc),expires=value.expiresAtUtc===null?null:Date.parse(value.expiresAtUtc);
    if(!Number.isFinite(serverNow)||expires!==null&&!Number.isFinite(expires))throw Object.assign(new Error("DEVICE_EXPIRY_INVALID"),{code:"DEVICE_EXPIRY_INVALID"});
    if(deviceExpiryTimer.current!==null)clearTimeout(deviceExpiryTimer.current);
    setDeviceExpiryInfo({expiresAtUtc:value.expiresAtUtc,offset:serverNow-Date.now()});
    if(expires!==null){
      const deadline=Date.now()+expires-serverNow;
      const check=()=>{const remaining=deadline-Date.now();if(remaining<=0)clearDevicePlayback("裝置授權已到期，已清除患者資料；請聯絡管理者。");else deviceExpiryTimer.current=setTimeout(check,Math.min(2147483647,remaining));};
      check();if(expires<=serverNow)throw new Error("DEVICE_EXPIRED");
    }
  }
  function armDeviceLease(expires: number) {
    if (!Number.isSafeInteger(expires) || expires <= Date.now()) throw new Error("KIOSK_LEASE_INVALID");
    if (deviceLeaseDeadline.current !== null) clearTimeout(deviceLeaseDeadline.current);
    deviceLeaseDeadline.current = setTimeout(() => clearDevicePlayback("裝置授權已到期，已清除患者資料；請重新授權。"), Math.min(2147483647, expires-Date.now()));
  }
  useEffect(() => {
    if (!persistentCapable || window.opener || searchParams.get("handoff") === "1") return;
    clearDevicePlayback("");
    const attempt = ++activationAttempt.current;
    setRestoringDevice(true);
    let stopped = false;
    const controller = new AbortController();
    void apiRequest<{deviceId:number;dashboardId:number;authorizationExpiresAt:number}>(`/dashboards/device/${dashboardId}/kiosk/session`, {
      method:"POST",signal:controller.signal,headers:{"X-UQP-Kiosk":"1"},body:JSON.stringify({deviceId:intendedDeviceId})
    }).then(value => {
      if (stopped || attempt !== activationAttempt.current) return;
      if (value.deviceId !== intendedDeviceId || value.dashboardId !== dashboardId) throw new Error("KIOSK_DEVICE_MISMATCH");
      armDeviceLease(value.authorizationExpiresAt); setDeviceToken("COOKIE_SESSION"); setActivationRequired(false); setActivationError("");
    }).catch(() => { if (!stopped && attempt === activationAttempt.current) setActivationError("未找到有效的持久授權。請輸入此裝置 Token，確認 HTTPS 設定後重新啟用。"); }).finally(()=>{if(!stopped && attempt===activationAttempt.current)setRestoringDevice(false);});
    return () => { stopped = true; ++activationAttempt.current; controller.abort(); if (deviceLeaseDeadline.current !== null) clearTimeout(deviceLeaseDeadline.current); };
  }, [dashboardId, intendedDeviceId, persistentCapable]);
  useEffect(() => {
    if (!deviceMode) return;
    const leave = () => {++activationAttempt.current;flushSync(() => clearDevicePlayback("頁面已離開，已清除患者資料。"));};
    // Purge before a page enters the browser back/forward cache. A restored page
    // reloads and revalidates its enrollment rather than resurrecting a PHI snapshot.
    const shown = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pagehide",leave); window.addEventListener("pageshow",shown);
    // Polling and request deadlines below protect visible playback; avoid pausing
    // ordinary kiosk playback solely because a browser control opened another tab.
    return () => { window.removeEventListener("pagehide",leave); window.removeEventListener("pageshow",shown); if (deviceLeaseDeadline.current !== null) clearTimeout(deviceLeaseDeadline.current);if(deviceExpiryTimer.current!==null)clearTimeout(deviceExpiryTimer.current); };
  }, [deviceMode, clearDevicePlayback]);

  async function forgetPersistentDevice() {
    try { await apiRequest(`/dashboards/device/${dashboardId}/kiosk/forget`,{method:"POST",headers:{"X-UQP-Kiosk":"1"},body:JSON.stringify({deviceId:intendedDeviceId})}); }
    catch { clearDevicePlayback("無法確認 Cookie 已清除；請清除此網站瀏覽資料或由管理者撤銷裝置。"); return; }
    clearDevicePlayback("已清除此瀏覽器持久授權；重新播放須再次輸入 Token。");
  }

  const clearUserPlayback = useCallback((message: string) => {
    for (const timer of userSourceExpiry.current.values()) window.clearTimeout(timer); userSourceExpiry.current.clear();
    ++latestDataRequest.current; ++latestLayoutRequest.current; ++supplementalRequestGeneration.current;
    pageSnapshotId.current = null; pageSnapshotCreatedAt.current = 0; lastVisibleColumns.current = [];
    setPreview(null); setSupplementalPages({}); setSupplementalErrors({}); setProfiles([]); setCountdown(0);
    setPreviewAuthorized(false); setDataWarning(""); setError(message);
  }, []);
  useEffect(() => {
    if (!userRoute) return;
    let stopped = false, inFlight = false;
    let observedMode: string | null = null;
    const controller = new AbortController();
    if (userAuthorizationExpiry.current !== null) window.clearTimeout(userAuthorizationExpiry.current);
    for (const timer of userSourceExpiry.current.values()) window.clearTimeout(timer); userSourceExpiry.current.clear();
    ++latestDataRequest.current; ++latestLayoutRequest.current; ++supplementalRequestGeneration.current;
    pageSnapshotId.current = null; setPreview(null); setSupplementalPages({}); setProfiles([]); setUserMode(null);
    setUserSession(null); userSecurityVersion.current = null; setPreviewAuthorized(true);
    const verify = async () => {
      if (stopped || inFlight || !navigator.onLine) return;
      inFlight = true;
      const deadline = window.setTimeout(() => controller.abort(), 5000);
      try {
        const value = await apiRequest<{mode: string; securityVersion?: string; authorizationExpiresAt?: number; dashboard?: DashboardRow; profiles?: LayoutProfile[]}>(`/dashboards/${dashboardId}/playback/v1`, {signal: controller.signal}, accessToken);
        if (stopped) return;
        if (observedMode !== null && observedMode !== value.mode) throw new Error("PLAYBACK_MODE_CHANGED");
        observedMode = value.mode;
        if (value.mode === "LEGACY" && userSecurityVersion.current === null) {
          setUserMode("LEGACY"); setUserSession(accessToken); return;
        }
        if (value.mode !== "QUERY_ONLY" || typeof value.securityVersion !== "string" || !/^[a-f0-9]{64}$/.test(value.securityVersion) ||
          value.dashboard?.id !== dashboardId || !Array.isArray(value.profiles) || !Number.isSafeInteger(value.authorizationExpiresAt) || value.authorizationExpiresAt! <= Date.now()) throw new Error("PLAYBACK_STATE_INVALID");
        if (userSecurityVersion.current !== value.securityVersion) {
          ++latestDataRequest.current; ++latestLayoutRequest.current; ++supplementalRequestGeneration.current;
          pageSnapshotId.current = null; setPreview(null); setSupplementalPages({}); setPage(1); setCountdown(0);
          setProfiles(value.profiles); userSecurityVersion.current = value.securityVersion;
          setSnapshotReloadKey(k => k + 1);
        }
        if (userAuthorizationExpiry.current !== null) window.clearTimeout(userAuthorizationExpiry.current);
        userAuthorizationExpiry.current = window.setTimeout(() => { stopped = true; clearUserPlayback("登入憑證已到期，已清除所有患者資料；請重新登入。"); }, Math.min(2_147_483_647, value.authorizationExpiresAt! - Date.now()));
        setUserSession(accessToken); setUserMode("QUERY_ONLY");
      } catch {
        if (!stopped) { stopped = true; setUserSession(accessToken); clearUserPlayback("播放安全驗證失敗，已清除所有患者資料；請重新登入或請管理者確認權限與政策。"); }
      } finally { window.clearTimeout(deadline); inFlight = false; }
    };
    void verify(); const timer = window.setInterval(() => void verify(), 5000);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); if (userAuthorizationExpiry.current !== null) window.clearTimeout(userAuthorizationExpiry.current); for (const expiry of userSourceExpiry.current.values()) window.clearTimeout(expiry); userSourceExpiry.current.clear(); ++latestDataRequest.current; ++supplementalRequestGeneration.current; };
  }, [dashboardId, accessToken, userRoute, clearUserPlayback]);

  useEffect(() => {
    if (!userRoute) return;
    const hidden = () => { if (document.visibilityState === "hidden") clearUserPlayback("頁面已離開前景，已清除患者資料；請重新開啟播放。"); };
    const pageHidden = () => clearUserPlayback("頁面已離開，已清除患者資料；請重新開啟播放。");
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", pageHidden);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", pageHidden); };
  }, [userRoute, clearUserPlayback]);

  // Supplemental sources refresh independently; never cache PHI across token/network changes.
  useEffect(() => {
    const generation = ++supplementalRequestGeneration.current;
    setSupplementalPages({});
    setSupplementalErrors({});
    if ((userRoute && userMode === null) || !previewAuthorized || !online || (deviceMode ? !deviceToken || activationRequired : !accessToken)) return;
    const keys = [...new Set(profiles.flatMap((profile) => profile.widgets
      .filter((widget) => widget.widgetType === "FIELD" || widget.widgetType === "TABLE")
      .map((widget) => widget.config?.dataSourceKey)
      .filter((key): key is string => typeof key === "string" && key !== "PRIMARY" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))))];
    const previewCache = new Map<string, { id: string; data: SupplementalPage }>();
    let previewRevision = 0;
    const stops = keys.map((key) => startSourcePlayback<SupplementalPage>({
      fetchPage: async (requestedPage, snapshotId, signal) => {
        if (deviceMode) return apiRequest<SupplementalPage>(
          `/dashboards/device/${dashboardId}/data-sources/${encodeURIComponent(key)}/page`,
          { method: "POST", signal, body: JSON.stringify({ page: requestedPage, ...(snapshotId ? { snapshotId } : {}) }),
            headers: deviceHeaders }, null);
        if (userMode === "QUERY_ONLY") {
          if (!snapshotId) setSupplementalPages(previous => { const next = {...previous}; delete next[key]; return next; });
          return apiRequest<SupplementalPage>(`/dashboards/${dashboardId}/playback/v1/${encodeURIComponent(key)}/page`,
            { method: "POST", signal, body: JSON.stringify({page: requestedPage, ...(snapshotId ? {snapshotId} : {})}) }, accessToken).catch(error => {
              if (generation === supplementalRequestGeneration.current) clearUserPlayback("來源安全驗證失敗，已清除所有患者資料；請重新開啟播放。");
              throw error;
            });
        }
        if (queryPreview) return apiRequest<SupplementalPage>(`/dashboards/${dashboardId}/query-sources/v1/${encodeURIComponent(key)}/page`,
          {method:"POST",signal,body:JSON.stringify({page:requestedPage,...(snapshotId?{snapshotId}: {})})},accessToken).catch(error=>{
            if(previewAuthorizationFailed(error))throw Object.assign(new Error("PREVIEW_AUTHORIZATION_FAILED"),{status:401});
            throw error;
          });
        // Designer playback previews reuse their masked, capped result for local pagination.
        let cached = previewCache.get(key);
        if (!cached || !snapshotId || cached.id !== snapshotId) {
          const data = await apiRequest<SupplementalPage>(`/dashboards/${dashboardId}/data-sources/${encodeURIComponent(key)}/preview`,
            { method: "POST", signal }, accessToken).catch(error => {
              previewCache.delete(key);
              if (previewAuthorizationFailed(error)) throw Object.assign(new Error("PREVIEW_AUTHORIZATION_FAILED"), { status: 401 });
              throw error;
            });
          cached = { id: `preview-${++previewRevision}`, data };
          previewCache.set(key, cached);
        }
        const size = Math.max(1, cached.data.pageSize);
        const totalPages = Math.max(1, Math.ceil(cached.data.result.rows.length / size));
        const currentPage = Math.min(requestedPage, totalPages);
        return { ...cached.data, page: currentPage, totalPages, snapshotId: cached.id,
          result: { ...cached.data.result, rows: cached.data.result.rows.slice((currentPage - 1) * size, currentPage * size) } };
      },
      show: (result) => {
        if (generation !== supplementalRequestGeneration.current || !navigator.onLine) return;
        if (userRoute && userMode === "QUERY_ONLY") {
          if (!Number.isFinite(result.snapshotExpiresAt) || result.snapshotExpiresAt! <= Date.now()) { clearUserPlayback("快照期限證據失效，已停止播放。"); return; }
          window.clearTimeout(userSourceExpiry.current.get(key));
          userSourceExpiry.current.set(key, window.setTimeout(() => {
            if (generation !== supplementalRequestGeneration.current) return;
            setSupplementalPages(previous => { const next = {...previous}; delete next[key]; return next; });
          }, Math.min(2_147_483_647, result.snapshotExpiresAt! - Date.now())));
        }
        setSupplementalPages(previous => ({ ...previous, [key]: result }));
        setSupplementalErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
      },
      clear: () => {
        if (generation !== supplementalRequestGeneration.current) return;
        setSupplementalPages(previous => previous[key] ? { ...previous, [key]: retainSourceColumns(previous[key]!) } : previous);
      },
      failed: (_status, error) => {
        if (generation !== supplementalRequestGeneration.current) return;
        setSupplementalErrors(previous => ({ ...previous, [key]: sourcePreviewFailure(key, error) }));
      },
      unauthorized: () => {
        if (!deviceMode) {
          {++latestDataRequest.current;++latestLayoutRequest.current;++supplementalRequestGeneration.current;pageSnapshotId.current=null;setPreviewAuthorized(false);setPreview(null);setProfiles([]);setSupplementalPages({});setError("預覽授權失效，請重新登入後開啟預覽。");}
          return;
        }
        ++supplementalRequestGeneration.current;
        ++latestDataRequest.current;
        ++latestLayoutRequest.current;
        pageSnapshotId.current = null;
        forgetDashboardToken(dashboardId);
        setDeviceToken(null);
        setActivationRequired(true);
        setPreview(null);
        setSupplementalPages({});
        setProfiles([]);
        setCountdown(0);
        setActivationError("裝置授權失效，請重新驗證。");
      },
    }));
    return () => { ++supplementalRequestGeneration.current; stops.forEach(stop => stop()); };
  }, [dashboardId, deviceMode, deviceToken, online, activationRequired, profiles, accessToken, queryPreview, previewAuthorized, userRoute, userMode, clearUserPlayback, intendedDeviceId, userRoute ? snapshotReloadKey : 0]);

  const loadData = useCallback(async () => {
    if (!Number.isFinite(dashboardId) || (userRoute && userMode === null)) return;
    const requestId = ++latestDataRequest.current;
    if ((serverPaged) && !navigator.onLine) {
      pageSnapshotId.current = null;
      setPreview(null);
      setCountdown(0);
      setDataWarning("網路中斷，已清除患者資料；連線恢復後重新載入。");
      return;
    }
    try {
      if (deviceMode && !deviceToken) {
        setActivationRequired(true);
        setError("");
        return;
      }

      if(!previewAuthorized)return;
      const configuration = queryPreview && !deviceMode ? await apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`,{},accessToken) : null;
      const response = await apiRequest<PreviewResult & {query?:{name:string;code:string}}>(
        deviceMode
          ? `/dashboards/device/${dashboardId}/page`
          : userMode === "QUERY_ONLY" ? `/dashboards/${dashboardId}/playback/v1/PRIMARY/page` : queryPreview ? `/dashboards/${dashboardId}/query-sources/v1/PRIMARY/page` : `/dashboards/${dashboardId}/preview`,
        {
          method: "POST",
          body: serverPaged ? JSON.stringify({ page, ...(pageSnapshotId.current ? { snapshotId: pageSnapshotId.current } : {}) }) : undefined,
          headers: deviceMode
            ? deviceHeaders
            : undefined,
        },
        deviceMode ? null : accessToken,
      );
      const result:PreviewResult = configuration ? {...response,dashboard:{
        id:dashboardId,name:response.query?.name ?? "Query-only 預覽",code:response.query?.code ?? "",
        parameters:configuration.primary.parameters ?? {},refreshSeconds:configuration.primary.refreshSeconds,
        pageSeconds:configuration.primary.pageSeconds,pageSize:configuration.primary.pageSize},reportColumns:[]} : response;
      if (requestId !== latestDataRequest.current || ((serverPaged) && !navigator.onLine)) return;
      if ((serverPaged) && result.page !== page) return;
      if (serverPaged) {
        if (pageSnapshotId.current !== result.snapshotId) pageSnapshotCreatedAt.current = Date.now();
        pageSnapshotId.current = result.snapshotId ?? null;
      }
      if (userRoute && userMode === "QUERY_ONLY" && (!Number.isFinite(result.snapshotExpiresAt) || result.snapshotExpiresAt! <= Date.now())) throw new Error("SNAPSHOT_EXPIRY_INVALID");
      setPreview(result);
      setLastUpdatedAt(new Date());
      setDataWarning("");
      setRetryDelaySeconds(5);
      setError("");
      if (deviceMode) { setActivationRequired(false); setActivationError(""); }
    } catch (e) {
      if (requestId !== latestDataRequest.current) return;
      if (cookieSession && !["DASHBOARD_SNAPSHOT_EXPIRED","DASHBOARD_PAGE_OUT_OF_RANGE"].includes((e as {code?:string}).code ?? "")) { clearDevicePlayback("播放安全驗證失敗，已清除患者資料；請確認授權與政策後重新開啟。"); return; }
      if (userRoute && userMode === "QUERY_ONLY") { clearUserPlayback("播放要求失敗，已清除所有患者資料與快照；請重新開啟播放。"); return; }
      if ((serverPaged) && (e as { code?: string }).code === "DASHBOARD_SNAPSHOT_EXPIRED") {
        pageSnapshotId.current = null;
        setPreview(null);
        setPage(1);
        setCountdown(0);
        setError("");
        setDataWarning("播放資料版本已過期，正在重新載入。");
        // Changing page to 1 is a no-op when already on page 1.
        // A separate reload key guarantees the first page is fetched again.
        setSnapshotReloadKey((key) => key + 1);
        return;
      }
      if ((serverPaged) && (e as { code?: string }).code === "DASHBOARD_PAGE_OUT_OF_RANGE" && page !== 1) {
        // The dataset shrank between page requests; restart from the first page.
        setPreview(null);
        setPage(1);
        setCountdown(0);
        setDataWarning("資料筆數已變更，正在從第一頁重新載入。");
        return;
      }
      if(!deviceMode && previewAuthorizationFailed(e)){
        ++latestDataRequest.current;++latestLayoutRequest.current;++supplementalRequestGeneration.current;pageSnapshotId.current=null;
        setPreviewAuthorized(false);setPreview(null);setProfiles([]);setSupplementalPages({});setError("預覽授權失效，請重新登入後開啟預覽。");return;
      }
      if (deviceMode && (e as { status?: number }).status === 401) {
        ++latestDataRequest.current;
        pageSnapshotId.current = null;
        forgetDashboardToken(dashboardId);
        setDeviceToken(null);
        setActivationRequired(true);
        setPreview(null);
        ++supplementalRequestGeneration.current;
        setSupplementalPages({});
        setProfiles([]);
        setCountdown(0);
        setDataWarning("");
        setLayoutWarning("");
        setError("");
        setActivationError("裝置授權失效，請由管理者重新核發憑證。");
      } else {
        {
          pageSnapshotId.current = null;
          setPreview(null);
          setCountdown(0);
        }
        const status=(e as {status?:number}).status;
        const message = sourcePreviewFailure("PRIMARY", e);
        setDataWarning(message);
        setRetryDelaySeconds((previous) => Math.min(previous * 2, 60));
        setError(message);
      }
    }
  }, [accessToken, dashboardId, deviceMode, deviceToken, page, snapshotReloadKey, queryPreview, previewAuthorized, serverPaged, userRoute, userMode, clearUserPlayback]);

  const loadLayout = useCallback(async () => {
    if (!Number.isFinite(dashboardId) || (userRoute && userMode !== "LEGACY")) return;
    const requestId = ++latestLayoutRequest.current;

    if (previewKey && !userRoute) {
      try {
        const raw = sessionStorage.getItem(previewKey);
        if (!raw) {
          setError("版型預覽資料已不存在，請回到版面設計重新預覽。");
          return;
        }
        const profile = JSON.parse(raw) as LayoutProfile;
        setProfiles([profile]);
        return;
      } catch {
        setError("版型預覽資料格式不正確，請回到版面設計重新預覽。");
        return;
      }
    }

    try {
      if (deviceMode && !deviceToken) {
        setActivationRequired(true);
        setError("");
        return;
      }

      const result = await apiRequest<{ profiles: LayoutProfile[];deviceAuthorization?:{expiresAtUtc:string|null;serverNowUtc:string} }>(
        deviceMode
          ? `/dashboards/device/${dashboardId}/layout`
          : `/dashboards/${dashboardId}/layout`,
        {
          headers: deviceMode
            ? deviceHeaders
            : undefined,
        },
        deviceMode ? null : accessToken,
      );
      if (requestId !== latestLayoutRequest.current || ((serverPaged) && !navigator.onLine)) return;
      if(deviceMode)applyDeviceAuthorization(result.deviceAuthorization);
      setProfiles(result.profiles);
      setLayoutWarning("");
    } catch (e) {
      if (requestId !== latestLayoutRequest.current) return;
      if (cookieSession || (e as {code?:string}).code==="DEVICE_EXPIRY_INVALID") { clearDevicePlayback("裝置授權失效，已清除患者資料；請重新啟用。"); return; }
      if (deviceMode && [401, 403].includes((e as { status?: number }).status ?? 0)) {
        ++latestDataRequest.current;
        pageSnapshotId.current = null;
        forgetDashboardToken(dashboardId);
        setDeviceToken(null);
        setActivationRequired(true);
        setPreview(null);
        ++supplementalRequestGeneration.current;
        setSupplementalPages({});
        setProfiles([]);
        setCountdown(0);
        setLayoutWarning("");
        setError("");
        setActivationError("裝置授權失效，請由管理者重新核發憑證。");
      } else {
        const message = "Dashboard 版面暫時無法讀取，請確認授權與服務狀態。";
        setLayoutWarning(message);
        setLayoutRetryCount((count) => count + 1);
        setError(message);
      }
    }
  }, [accessToken, dashboardId, deviceMode, deviceToken, previewKey, serverPaged, userRoute, userMode, intendedDeviceId]);

  // Verify the device lease independently of long refresh/page intervals; no clinical Query runs here.
  useEffect(()=>{
    if(!deviceMode || !deviceToken || activationRequired)return;
    let stopped=false,inFlight=false;
    const controller=new AbortController();
    const verify=async()=>{
      if(stopped || inFlight || !navigator.onLine)return;
      inFlight=true;
      const deadline=window.setTimeout(()=>controller.abort(),5000);
      try {
        if (cookieSession) {
          const value = await apiRequest<{deviceId:number;dashboardId:number;authorizationExpiresAt:number}>(`/dashboards/device/${dashboardId}/kiosk/session`,{method:"POST",signal:controller.signal,headers:{"X-UQP-Kiosk":"1"},body:JSON.stringify({deviceId:intendedDeviceId})});
          if (stopped) return;
          if (value.deviceId !== intendedDeviceId || value.dashboardId !== dashboardId) throw new Error("KIOSK_DEVICE_MISMATCH");
          armDeviceLease(value.authorizationExpiresAt);
        }
        const layout=await apiRequest<{deviceAuthorization?:{expiresAtUtc:string|null;serverNowUtc:string}}>(`/dashboards/device/${dashboardId}/layout`,{signal:controller.signal,headers:deviceHeaders},null);
        if(!stopped)applyDeviceAuthorization(layout.deviceAuthorization);
      }
      catch {
        if(stopped || !navigator.onLine)return;
        ++latestDataRequest.current;++latestLayoutRequest.current;++supplementalRequestGeneration.current;
        pageSnapshotId.current=null;forgetDashboardToken(dashboardId);setDeviceToken(null);setActivationRequired(true);
        setPreview(null);setProfiles([]);setSupplementalPages({});setCountdown(0);
        setActivationError("裝置授權檢查未通過或服務暫不可用，已停止播放；請由管理者確認並重新授權。");
      } finally {window.clearTimeout(deadline);inFlight=false;}
    };
    const visible=()=>{if(document.visibilityState==="visible")void verify();};
    const timer=window.setInterval(()=>void verify(),15000);
    document.addEventListener("visibilitychange",visible);
    return ()=>{stopped=true;controller.abort();window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[deviceMode,deviceToken,activationRequired,dashboardId,intendedDeviceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);


  useEffect(() => {
    if (!deviceMode) return;

    type ManagedScreen = {
      label?: string;
      availLeft: number;
      availTop: number;
      availWidth: number;
      availHeight: number;
    };

    type DisplaySettings = {
      autoFullscreen?: boolean;
      screenIndex?: number | null;
      screenLabel?: string | null;
      screenBounds?: {
        left: number;
        top: number;
        width: number;
        height: number;
      } | null;
    };

    let settings: DisplaySettings = {};
    try {
      const raw = localStorage.getItem(`uqp.dashboard.display-settings.${dashboardId}`);
      if (raw) settings = JSON.parse(raw) as DisplaySettings;
    } catch {
      settings = {};
    }

    const applyScreen = async () => {
      const windowWithScreens = window as typeof window & {
        getScreenDetails?: () => Promise<{ screens: ManagedScreen[] }>;
      };

      try {
        if (windowWithScreens.getScreenDetails) {
          const details = await windowWithScreens.getScreenDetails();
          const preferred =
            details.screens.find((screen) => settings.screenLabel && screen.label === settings.screenLabel)
            ?? (settings.screenIndex != null ? details.screens[settings.screenIndex] : undefined);

          if (preferred) {
            window.moveTo(preferred.availLeft, preferred.availTop);
            window.resizeTo(preferred.availWidth, preferred.availHeight);
          }
        } else if (settings.screenBounds) {
          window.moveTo(settings.screenBounds.left, settings.screenBounds.top);
          window.resizeTo(settings.screenBounds.width, settings.screenBounds.height);
        }
      } catch {
        // Browser may deny window-management permission. Playback remains usable on current screen.
      }

      if (settings.autoFullscreen || autoFullscreenRequested) {
        try {
          if(!await requestDashboardFullscreen(document)){setFullscreenNeedsClick(true);return;}
          setFullscreenNeedsClick(false);
        } catch {
          setFullscreenNeedsClick(true);
        }
      }
    };

    void applyScreen();
  }, [autoFullscreenRequested, dashboardId, deviceMode]);

  useEffect(() => {
    const handleFullscreen = () => {
      const active=dashboardFullscreenActive(document);setFullscreenActive(active);
      if (active) setFullscreenNeedsClick(false);
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    document.addEventListener("webkitfullscreenchange",handleFullscreen);
    return () => {document.removeEventListener("fullscreenchange", handleFullscreen);document.removeEventListener("webkitfullscreenchange",handleFullscreen);};
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleResize = () => setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
    });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const activeProfile = useMemo(() => {
    if (previewKey && profiles.length > 0) return profiles[0];

    if (Number.isFinite(requestedProfileId)) {
      const requested = profiles.find((profile) => profile.id === requestedProfileId);
      if (requested) return requested;
    }

    if (profiles.length === 0) return null;

    const viewportRatio = viewport.width / Math.max(1, viewport.height);
    const ranked = profiles
      .map((profile) => {
        const profileRatio = profile.canvasWidth / Math.max(1, profile.canvasHeight);
        const ratioPenalty = Math.abs(Math.log(profileRatio / viewportRatio));
        const scale = Math.min(
          viewport.width / profile.canvasWidth,
          viewport.height / profile.canvasHeight,
        );
        const scalePenalty = Math.abs(Math.log(Math.max(scale, 0.01)));
        const defaultBonus = profile.isDefault ? -0.02 : 0;
        return { profile, score: ratioPenalty * 4 + scalePenalty + defaultBonus };
      })
      .sort((a, b) => a.score - b.score);

    return ranked[0]?.profile
      ?? profiles.find((profile) => profile.isDefault)
      ?? profiles[0];
  }, [previewKey, profiles, requestedProfileId, viewport]);

  const pageSize = Math.max(1, preview?.dashboard.pageSize ?? 5);
  const pageSeconds = Math.max(5, preview?.dashboard.pageSeconds ?? 20);
  const refreshSeconds = Math.max(5, preview?.dashboard.refreshSeconds ?? 10);
  const totalPages = serverPaged
    ? Math.max(1, preview?.totalPages ?? 1)
    : Math.max(1, Math.ceil((preview?.result.rows.length ?? 0) / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    if (!preview) return [];
    if (serverPaged) return preview.page === safePage ? preview.result.rows : [];
    const start = (safePage - 1) * pageSize;
    return preview.result.rows.slice(start, start + pageSize);
  }, [deviceMode, queryPreview, pageSize, preview, safePage, serverPaged]);

  const visibleColumns = useMemo(() => {
    if (!preview) return lastVisibleColumns.current;
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

  useEffect(() => {
    if (preview) lastVisibleColumns.current = visibleColumns;
  }, [preview, visibleColumns]);

  // Continue retrying even when the first load fails; do not discard last successful data.
  // SQL refresh uses snapshot creation time, independent of page rotation and cycle wrap.
  useEffect(() => {
    if (!(serverPaged) || !previewAuthorized || (deviceMode && (activationRequired || !deviceToken)) || !online || dataWarning ||
        !preview) return;
    const timer = window.setTimeout(() => {
      pageSnapshotId.current = null;
      if (userRoute) { setPreview(null); ++supplementalRequestGeneration.current; setSupplementalPages({}); }
      setSnapshotReloadKey((key) => key + 1);
    }, Math.max(1, (userRoute && preview.snapshotExpiresAt ? preview.snapshotExpiresAt - Date.now() : refreshSeconds * 1000 - (Date.now() - pageSnapshotCreatedAt.current))));
    return () => window.clearTimeout(timer);
  }, [deviceMode, queryPreview, previewAuthorized, activationRequired, deviceToken, online, dataWarning, preview, totalPages, refreshSeconds, serverPaged, userRoute]);

  useEffect(() => {
    if (deviceMode && activationRequired) return;
    // Device playback retains the same snapshot within a page; periodic refresh only retries failures.
    if ((serverPaged) && !dataWarning) return;
    const delay = dataWarning ? retryDelaySeconds : refreshSeconds;
    const timer = window.setTimeout(() => void loadData(), delay * 1000);
    return () => window.clearTimeout(timer);
  }, [loadData, refreshSeconds, dataWarning, retryDelaySeconds, lastUpdatedAt, deviceMode, queryPreview, activationRequired, serverPaged]);

  useEffect(() => {
    if (deviceMode && activationRequired) return;
    if (!layoutWarning) return;
    const timer = window.setTimeout(() => void loadLayout(), 15000);
    return () => window.clearTimeout(timer);
  }, [loadLayout, layoutWarning, layoutRetryCount, deviceMode, activationRequired]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      if (serverPaged) {
        pageSnapshotId.current = null;
        setPreview(null);
        setPage(1);
        setCountdown(0);
        setSnapshotReloadKey((key) => key + 1);
      } else if (!activationRequired) {
        void loadData();
      }
      if (!activationRequired) void loadLayout();
    };
    const onOffline = () => {
      ++activationAttempt.current;
      ++latestLayoutRequest.current;
      setActivationBusy(false);
      ++latestDataRequest.current;
      setOnline(false);
      if (serverPaged) {
        pageSnapshotId.current = null;
        setPreview(null);
        ++supplementalRequestGeneration.current;
        setSupplementalPages({});
        setCountdown(0);
        setDataWarning("網路中斷，暫停顯示患者資料；連線恢復後重新載入。");
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [loadData, loadLayout, activationRequired, deviceMode, queryPreview, serverPaged]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), totalPages));
  }, [totalPages]);

  useEffect(() => {
    pageSnapshotId.current = null;
    pageSnapshotCreatedAt.current = 0;
  }, [deviceMode, dashboardId, deviceToken]);

  // Do not run a page-advance timer for empty results or a single-page view.
  const canAdvancePage = Boolean(preview && preview.result.rows.length > 0 && totalPages > 1) &&
    (previewAuthorized && online && !dataWarning && (!(serverPaged) || preview?.page === safePage)) &&
    (!deviceMode || (!activationRequired && Boolean(deviceToken) && online &&
      !dataWarning && preview?.page === safePage));

  useEffect(() => {
    if (!canAdvancePage) { setCountdown(0); return; }
    const deadline = Date.now() + pageSeconds * 1000;
    setCountdown(pageSeconds);
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        window.clearInterval(timer);
        // React may invoke state updaters twice; page advancement must stay outside countdown updaters.
        setPage(currentPage => currentPage >= totalPages ? 1 : currentPage + 1);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [dashboardId, pageSeconds, totalPages, canAdvancePage, safePage, preview?.page]);

  const scale = useMemo(() => {
    if (!activeProfile) return 1;
    return Math.min(
      viewport.width / activeProfile.canvasWidth,
      viewport.height / activeProfile.canvasHeight,
    );
  }, [activeProfile, viewport]);

  function renderWidget(widget: LayoutWidget) {
    const sourceKey = typeof widget.config?.dataSourceKey === "string" ? widget.config.dataSourceKey : "PRIMARY";
    const supplemental = sourceKey !== "PRIMARY" ? supplementalPages[sourceKey] : undefined;
    const widgetRows = sourceKey === "PRIMARY" ? pageRows : supplemental?.result.rows ?? [];
    const widgetColumns = sourceKey === "PRIMARY" ? visibleColumns
      : (supplemental?.result.columns ?? []).map((column) => ({
        columnName: column.name, displayLabel: column.name, alignment: "LEFT" as const,
      }));
    const sourceFailure = sourceKey === "PRIMARY" ? dataWarning : supplementalErrors[sourceKey];
    const firstRow = widgetRows[0] ?? (sourceKey === "PRIMARY" && !serverPaged ? preview?.result.rows[0] : undefined) ?? {};
    const parameters = preview?.dashboard.parameters ?? {};

    if (widget.widgetType === "CONTAINER") {
      return <div className="dashboard-play-container">{widget.title ?? ""}</div>;
    }

    if (widget.widgetType === "TABLE") {
      return (
        <div
          className="dashboard-play-table"
          style={{
            "--table-header-bg": configText(widget.config, "tableHeaderBackground", "#f1f4f8"),
            "--table-header-text": configText(widget.config, "tableHeaderTextColor", "#172033"),
            "--table-row-bg": configText(widget.config, "tableRowBackground", "#ffffff"),
            "--table-alt-row-bg": configText(widget.config, "tableAltRowBackground", "#f8fafc"),
            "--table-grid": configText(widget.config, "tableGridColor", "#dddddd"),
          } as CSSProperties}
        >
          <table>
            <thead>
              <tr>
                {widgetColumns.map((column) => (
                  <th scope="col" key={column.columnName}>{column.displayLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {widgetRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {widgetColumns.map((column) => (
                    <td
                      key={column.columnName}
                      style={{ textAlign: column.alignment.toLowerCase() as "left" | "center" | "right" }}
                    >
                      {formatDashboardValue(textValue(row[column.columnName]), (widget.config.columnFormats as Record<string,unknown> | undefined)?.[column.columnName])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {widgetRows.length === 0 && <div className="dashboard-play-empty" role={sourceFailure ? "alert" : undefined}>{sourceFailure || "目前沒有資料"}</div>}
        </div>
      );
    }

    let value = "";
    switch (widget.widgetType) {
      case "TEXT":
        value = widget.staticText ?? "";
        break;
      case "PARAMETER":
        value = widget.sourceKey ? textValue(parameters[widget.sourceKey]) : "";
        break;
      case "FIELD":
        if (sourceFailure) { value = sourceFailure; break; }
        value = widget.sourceKey
          ? formatDashboardValue(textValue(firstRow[widget.sourceKey]), widget.config.displayFormat)
          : "";
        break;
      case "CLOCK":
        value = now.toLocaleString("zh-TW", { hour12: false });
        break;
      case "PAGE_INFO":
        value = `目前頁數：${safePage} / ${totalPages}`;
        break;
      case "COUNTDOWN":
        value = `換頁倒數：${countdown} 秒`;
        break;
    }

    return (
      <div className="dashboard-play-value">
        {widget.title && widget.widgetType !== "TEXT" && (
          <span className="dashboard-play-label">{widget.title}</span>
        )}
        <strong>{value}</strong>
      </div>
    );
  }

  async function activateDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (transportBlocked) { clearDevicePlayback("HTTP 裝置播放尚未具備安全通道（BLOCKED）。"); return; }
    const token = activationInput.trim();
    if (!token || !Number.isInteger(dashboardId) || dashboardId <= 0) {
      setActivationError("請輸入有效的裝置 Token。");
      return;
    }
    const attempt = ++activationAttempt.current;
    setActivationBusy(true);
    setActivationError("");
    try {
      // Verify with the server BEFORE persisting; this endpoint enforces dashboard,
      // revocation, expiry and source-IP restrictions.
      if (persistDevice && persistentCapable) {
        const value = await apiRequest<{deviceId:number;dashboardId:number;authorizationExpiresAt:number}>(`/dashboards/device/${dashboardId}/kiosk/enrollment`,{method:"POST",headers:{"X-UQP-Kiosk":"1"},body:JSON.stringify({deviceId:intendedDeviceId,token})});
        if (attempt !== activationAttempt.current || !navigator.onLine) return;
        if (value.deviceId !== intendedDeviceId || value.dashboardId !== dashboardId) throw new Error("KIOSK_DEVICE_MISMATCH");
        armDeviceLease(value.authorizationExpiresAt);
      } else {const layout=await apiRequest<{ profiles: LayoutProfile[];deviceAuthorization?:{expiresAtUtc:string|null;serverNowUtc:string} }>(
        `/dashboards/device/${dashboardId}/layout`,
        { headers: { "X-Dashboard-Device-Token": token, ...(intendedDeviceId>0 ? {"X-UQP-Expected-Device-Id":String(intendedDeviceId)} : {}) } },
        null,
      );
      if(attempt===activationAttempt.current && navigator.onLine)applyDeviceAuthorization(layout.deviceAuthorization);}
      if (attempt !== activationAttempt.current || !navigator.onLine) return;
      pageSnapshotId.current = null;
      ++latestDataRequest.current;
      ++latestLayoutRequest.current;
      setPreview(null);
      setProfiles([]);
      setPage(1);
      setCountdown(0);
      setRetryDelaySeconds(5);
      setDataWarning("");
      setLayoutWarning("");
      if (persistDevice && persistentCapable) { forgetDashboardToken(dashboardId); setDeviceToken("COOKIE_SESSION"); }
      else { rememberDashboardToken(dashboardId, token); setDeviceToken(token); }
      setActivationInput("");
      setActivationRequired(false);
      setPreview(null);
      setProfiles([]);
      setError("");
    } catch (e) {
      if (attempt === activationAttempt.current) setActivationError("裝置驗證未通過，請確認授權、到期與工作站狀態，或請管理者重新核發憑證。");
    } finally {
      if (attempt === activationAttempt.current) setActivationBusy(false);
    }
  }

  if (userRoute && (!previewAuthorized || userSession !== accessToken || userMode === null)) return <main className="dashboard-display-screen"><div className="dashboard-display-error">
    <h1>{!previewAuthorized ? "Dashboard 播放已停止" : "驗證播放權限中…"}</h1>
    {!previewAuthorized && <p>{error || "已清除所有患者資料與快照，請重新登入或重新開啟播放。"}</p>}
    <Link to="/dashboards">返回 Dashboard</Link>
  </div></main>;

  if(queryPreview && !deviceMode && !previewAuthorized)return <main className="dashboard-display-screen"><div className="dashboard-display-error">
    <h1>預覽授權失效</h1><p>已停止預覽，請重新登入或請管理者確認權限。</p><Link to="/designer/dashboards">返回 Dashboard 管理</Link>
  </div></main>;

  if (transportBlocked) return <main className="dashboard-display-screen"><div className="dashboard-display-error" role="alert">
    <h1>HTTP 裝置播放尚未開放</h1>
    <p>Issue #77：BLOCKED。受管理 Windows 播放端與經驗證的加密資料通道尚未完成；目前不提供 HTTP 播放或重新開機後自動恢復。</p>
    <p>請勿在此連線輸入 Device Token。DPAPI 僅保護本機儲存，無法保護 HTTP 傳輸中的 Token 與患者資料。</p>
  </div></main>;

  if (deviceMode && activationRequired) {
    return (
      <main className="dashboard-display-screen">
        <div className="dashboard-display-error" style={{ maxWidth: 620 }}>
          <h1>啟用 Dashboard 播放裝置</h1>
          <p>Dashboard #{dashboardId} 尚未在目前瀏覽器設定檔完成驗證，或原有憑證已失效。</p>
          <p>請輸入管理員提供的 Device Token。若驗證失敗，系統會區分 Token 無效、到期、裝置停用或來源 IP 不符合限制。驗證成功後會自動播放，不需要登入管理後台。</p>
          <form onSubmit={(event) => void activateDevice(event)} style={{ display: "grid", gap: 12, marginTop: 16 }}>
            {persistentCapable ? <label><input type="checkbox" checked={persistDevice} onChange={e=>setPersistDevice(e.target.checked)}/>在此瀏覽器持久授權裝置 #{intendedDeviceId}（僅限受管理裝置；HTTPS 安全 Cookie）</label> : <p>目前僅支援本次頁面授權。持久授權須使用管理者提供的 HTTPS 裝置播放網址。</p>}
            <p>未啟用持久授權時，Token 僅保留於本次頁面記憶體；重新整理或關閉後需重新啟用。</p>
            <label htmlFor="dashboard-device-activation-token">Device Token</label>
            <input id="dashboard-device-activation-token" type="password" autoComplete="off" spellCheck={false} required
              value={activationInput} onChange={(event) => setActivationInput(event.target.value)}
              placeholder="貼上管理員提供的 Device Token" style={{ width: "100%", padding: 12, fontSize: 16 }} />
            {activationError && <p role="alert" style={{ color: "#b42318" }}>{activationError}</p>}
            <button type="submit" disabled={activationBusy || restoringDevice} style={{ padding: 12 }}>
              {restoringDevice ? "恢復授權中…" : activationBusy ? "驗證中…" : "驗證並啟用播放"}
            </button>
          </form>
          <p style={{ fontSize: 14, marginTop: 16 }}>等待管理者授權：持久授權僅適用 HTTPS 與固定瀏覽器設定檔；到期、撤銷或停用後仍須重新授權，網址本身不提供播放權限。</p>
          <Link to="/designer/dashboards">管理者登入並重新核發憑證</Link>
        </div>
      </main>
    );
  }

  if (error && !preview && profiles.length === 0) {
    return (
      <main className="dashboard-display-screen">
        <div className="dashboard-display-error">
          <h1>Dashboard 無法顯示</h1>
          <p>{error}</p>
          {!deviceMode && <SecurityManagementLinks dashboardId={dashboardId} />}
          {!deviceMode && <Link to="/dashboards">返回 Dashboard</Link>}
        </div>
      </main>
    );
  }

  if (!activeProfile) {
    return (
      <main className="dashboard-display-screen">
        <div className="dashboard-display-loading">
          {profiles.length === 0 && preview ? "尚未建立螢幕版型。" : "載入中…"}
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-display-screen">
      {!deviceMode && (dataWarning || error) && <aside role="status">{dataWarning || error}<SecurityManagementLinks dashboardId={Number(dashboardId)} /></aside>}
      {deviceMode && (
        <div role="status" aria-live="polite" style={{
          position: "fixed", right: 12, bottom: 12, zIndex: 9999,
          padding: "6px 10px", borderRadius: 6,
          background: !online || dataWarning || layoutWarning ? "#7f1d1d" : "rgba(0,0,0,.65)",
          color: "#fff", fontSize: 12, maxWidth: "min(75vw, 480px)",
        }}>
          {!online ? "網路已中斷，已清除患者資料；連線恢復後會重新載入" :
            dataWarning || layoutWarning ? dataWarning || layoutWarning :
            "播放正常"}
          {deviceExpiryInfo && deviceExpiry(deviceExpiryInfo.expiresAtUtc,now.getTime()+deviceExpiryInfo.offset).band==="DUE7" && <span> · 播放授權將於 7 天內到期，請通知管理者。</span>}
          {lastUpdatedAt && " · 最後更新 " + lastUpdatedAt.toLocaleTimeString("zh-TW")}
          {cookieSession && <button type="button" onClick={()=>void forgetPersistentDevice()}>清除此瀏覽器持久授權</button>}
        </div>
      )}
      <div
        className="dashboard-display-profile-shell"
        style={{
          width: activeProfile.canvasWidth * scale,
          height: activeProfile.canvasHeight * scale,
        }}
      >
        <div
          className="dashboard-display-profile-canvas"
          style={{
            width: activeProfile.canvasWidth,
            height: activeProfile.canvasHeight,
            transform: `scale(${scale})`,
            backgroundColor: configText(activeProfile.config ?? {}, "canvasBackgroundColor", "#ffffff"),
          }}
        >
          {activeProfile.widgets
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((widget) => (
              <div
                className="dashboard-play-widget"
                key={widget.id}
                style={{
                  left: widget.x,
                  top: widget.y,
                  width: widget.width,
                  height: widget.height,
                  fontSize: widget.fontSize,
                  textAlign: widget.alignment.toLowerCase() as "left" | "center" | "right",
                  ...widgetStyle(widget),
                  zIndex: widget.widgetType === "CONTAINER" ? 0 : 1,
                }}
              >
                {renderWidget(widget)}
              </div>
            ))}
        </div>
      </div>

      {!fullscreenActive && (
        <button
          className={`dashboard-fullscreen-button${fullscreenNeedsClick ? " needs-click" : ""}`}
          disabled={!fullscreenSupported}
          title={!fullscreenSupported ? "此瀏覽器不支援網頁全螢幕；可使用加入主畫面或瀏覽器全螢幕功能。" : undefined}
          type="button"
          onClick={async () => {
            try {
              if(!await requestDashboardFullscreen(document)){setFullscreenNeedsClick(true);return;}
              setFullscreenNeedsClick(false);
            } catch {
              setFullscreenNeedsClick(true);
            }
          }}
        >
          {!fullscreenSupported ? "請使用瀏覽器全螢幕／加入主畫面" : fullscreenNeedsClick ? "點一下進入全螢幕" : "全螢幕"}
        </button>
      )}
    </main>
  );
}
