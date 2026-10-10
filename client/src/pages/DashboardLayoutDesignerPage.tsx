import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./DashboardLayoutDesignerPage.css";

type DashboardRow = {
  id: number;
  code: string;
  name: string;
  parameters: Record<string, unknown>;
  pageSize: number;
  pageSeconds: number;
};

type ReportColumn = {
  columnName: string;
  displayLabel: string;
  displayOrder: number;
  isVisible: boolean;
  alignment: "LEFT" | "CENTER" | "RIGHT";
};

type PreviewResult = {
  dashboard: DashboardRow;
  reportColumns: ReportColumn[];
  result: {
    columns: { name: string }[];
    rows: Record<string, unknown>[];
  };
};

type WidgetType = "TEXT" | "PARAMETER" | "FIELD" | "CLOCK" | "PAGE_INFO" | "COUNTDOWN" | "TABLE";

type LayoutWidget = {
  id?: number | null;
  clientKey: string;
  widgetType: WidgetType;
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
  id?: number | null;
  clientKey: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  isDefault: boolean;
  sortOrder: number;
  widgets: LayoutWidget[];
};

type DragState = {
  widgetKey: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

const widgetLabels: Record<WidgetType, string> = {
  TEXT: "固定文字",
  PARAMETER: "Dashboard 參數",
  FIELD: "資料欄位",
  CLOCK: "系統時間",
  PAGE_INFO: "頁碼",
  COUNTDOWN: "換頁倒數",
  TABLE: "資料表格",
};

function clientKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type MaskMode = "NONE" | "NAME" | "MRN" | "PHONE" | "GENERIC";

const maskModeLabels: Record<MaskMode, string> = {
  NONE: "不遮蔽",
  NAME: "姓名遮蔽（王○佑）",
  MRN: "病歷號遮蔽",
  PHONE: "電話遮蔽",
  GENERIC: "一般遮蔽",
};

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function maskText(value: unknown, mode: unknown): string {
  const text = textValue(value);
  const maskMode = String(mode ?? "NONE") as MaskMode;
  if (!text || maskMode === "NONE") return text;

  if (maskMode === "NAME") {
    const chars = Array.from(text);
    if (chars.length <= 1) return "○";
    if (chars.length === 2) return `${chars[0]}○`;
    return `${chars[0]}${"○".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
  }

  if (maskMode === "MRN") {
    if (text.length <= 4) return "○".repeat(text.length);
    const head = text.slice(0, Math.min(4, text.length - 2));
    const tail = text.slice(-2);
    return `${head}${"○".repeat(Math.max(1, text.length - head.length - tail.length))}${tail}`;
  }

  if (maskMode === "PHONE") {
    if (text.length <= 5) return "○".repeat(text.length);
    return `${text.slice(0, 4)}${"○".repeat(Math.max(1, text.length - 7))}${text.slice(-3)}`;
  }

  if (text.length <= 2) return "○".repeat(text.length);
  return `${text.slice(0, 1)}${"○".repeat(text.length - 2)}${text.slice(-1)}`;
}

function getColumnMask(widget: LayoutWidget, columnName: string): MaskMode {
  const masks = widget.config?.columnMasks;
  if (!masks || typeof masks !== "object" || Array.isArray(masks)) return "NONE";
  return String((masks as Record<string, unknown>)[columnName] ?? "NONE") as MaskMode;
}

function withClientKeys(profile: Omit<LayoutProfile, "clientKey" | "widgets"> & {
  widgets: Omit<LayoutWidget, "clientKey">[];
}): LayoutProfile {
  return {
    ...profile,
    clientKey: clientKey("profile"),
    widgets: profile.widgets.map((widget) => ({
      ...widget,
      clientKey: clientKey("widget"),
    })),
  };
}

export function DashboardLayoutDesignerPage() {
  const { id } = useParams();
  const dashboardId = Number(id);
  const { accessToken } = useAuth();

  const [profiles, setProfiles] = useState<LayoutProfile[]>([]);
  const [activeProfileKey, setActiveProfileKey] = useState("");
  const [selectedWidgetKey, setSelectedWidgetKey] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function openPlayback(profileId?: number) {
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
        // If storage handoff fails, login will return to the requested playback path.
      }
    }

    const query = profileId ? `?profileId=${profileId}` : "";
    popup.location.replace(`/designer/dashboards/${dashboardId}/display${query}`);
  }
  const canvasStageRef = useRef<HTMLElement | null>(null);
  const [canvasViewport, setCanvasViewport] = useState({ width: 960, height: 620 });
  const [zoomMode, setZoomMode] = useState<"FIT" | "CUSTOM">("FIT");
  const [customScale, setCustomScale] = useState(0.5);

  const load = useCallback(async () => {
    if (!Number.isFinite(dashboardId)) return;
    setLoading(true);
    setError("");

    try {
      const [layoutResult, previewResult] = await Promise.all([
        apiRequest<{ profiles: Array<Omit<LayoutProfile, "clientKey" | "widgets"> & {
          widgets: Omit<LayoutWidget, "clientKey">[];
        }> }>(`/dashboards/${dashboardId}/layout`, {}, accessToken),
        apiRequest<PreviewResult>(
          `/dashboards/${dashboardId}/preview`,
          { method: "POST" },
          accessToken,
        ),
      ]);

      const loadedProfiles = layoutResult.profiles.map(withClientKeys);
      setProfiles(loadedProfiles);
      setActiveProfileKey(
        loadedProfiles.find((profile) => profile.isDefault)?.clientKey
          ?? loadedProfiles[0]?.clientKey
          ?? "",
      );
      setPreview(previewResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Dashboard 版面失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, dashboardId]);

  useEffect(() => { void load(); }, [load]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.clientKey === activeProfileKey) ?? null,
    [activeProfileKey, profiles],
  );

  const selectedWidget = useMemo(
    () => activeProfile?.widgets.find((widget) => widget.clientKey === selectedWidgetKey) ?? null,
    [activeProfile, selectedWidgetKey],
  );

  useEffect(() => {
    const element = canvasStageRef.current;
    if (!element) return;

    const updateSize = () => {
      const styles = window.getComputedStyle(element);
      const horizontalPadding =
        Number.parseFloat(styles.paddingLeft || "0") +
        Number.parseFloat(styles.paddingRight || "0");
      const verticalPadding =
        Number.parseFloat(styles.paddingTop || "0") +
        Number.parseFloat(styles.paddingBottom || "0");
      const infoReserve = 48;

      setCanvasViewport({
        width: Math.max(240, element.clientWidth - horizontalPadding - 8),
        height: Math.max(240, element.clientHeight - verticalPadding - infoReserve),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    window.addEventListener("resize", updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  const fitScale = useMemo(() => {
    if (!activeProfile) return 1;
    return Math.min(
      1,
      canvasViewport.width / activeProfile.canvasWidth,
      canvasViewport.height / activeProfile.canvasHeight,
    );
  }, [activeProfile, canvasViewport]);

  const scale = useMemo(() => {
    if (!activeProfile) return 1;
    const requested = zoomMode === "FIT" ? fitScale : customScale;
    const widthSafeScale = canvasViewport.width / activeProfile.canvasWidth;
    return Math.max(0.1, Math.min(1.5, requested, widthSafeScale));
  }, [activeProfile, canvasViewport.width, customScale, fitScale, zoomMode]);

  const visibleColumns = useMemo(() => {
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

  useEffect(() => {
    if (!drag || !activeProfile) return;

    const handleMove = (event: PointerEvent) => {
      const dx = (event.clientX - drag.startClientX) / scale;
      const dy = (event.clientY - drag.startClientY) / scale;

      setProfiles((current) => current.map((profile) => {
        if (profile.clientKey !== activeProfile.clientKey) return profile;
        return {
          ...profile,
          widgets: profile.widgets.map((widget) => {
            if (widget.clientKey !== drag.widgetKey) return widget;
            return {
              ...widget,
              x: Math.max(0, Math.min(
                profile.canvasWidth - widget.width,
                Math.round(drag.startX + dx),
              )),
              y: Math.max(0, Math.min(
                profile.canvasHeight - widget.height,
                Math.round(drag.startY + dy),
              )),
            };
          }),
        };
      }));
    };

    const handleUp = () => setDrag(null);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [activeProfile, drag, scale]);

  function updateActiveProfile(patch: Partial<LayoutProfile>) {
    if (!activeProfile) return;
    setProfiles((current) => current.map((profile) =>
      profile.clientKey === activeProfile.clientKey ? { ...profile, ...patch } : profile
    ));
  }

  function setDefaultProfile() {
    if (!activeProfile) return;
    setProfiles((current) => current.map((profile) => ({
      ...profile,
      isDefault: profile.clientKey === activeProfile.clientKey,
    })));
  }

  function addProfile(preset: "FHD_LANDSCAPE" | "FHD_PORTRAIT" | "HD" | "CUSTOM") {
    const sizes = {
      FHD_LANDSCAPE: [1920, 1080],
      FHD_PORTRAIT: [1080, 1920],
      HD: [1366, 768],
      CUSTOM: [1280, 720],
    } as const;

    const [canvasWidth, canvasHeight] = sizes[preset];
    const newProfile: LayoutProfile = {
      clientKey: clientKey("profile"),
      name: preset === "FHD_PORTRAIT" ? "新增直式版型" : "新增螢幕版型",
      canvasWidth,
      canvasHeight,
      isDefault: profiles.length === 0,
      sortOrder: profiles.length * 10,
      widgets: [],
    };

    setProfiles((current) => [...current, newProfile]);
    setActiveProfileKey(newProfile.clientKey);
    setSelectedWidgetKey("");
  }

  function deleteProfile() {
    if (!activeProfile || profiles.length <= 1) return;
    if (!window.confirm(`確定刪除版型「${activeProfile.name}」？`)) return;

    const remaining = profiles.filter((profile) => profile.clientKey !== activeProfile.clientKey);
    if (activeProfile.isDefault && remaining.length > 0) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    setProfiles(remaining);
    setActiveProfileKey(remaining[0]?.clientKey ?? "");
    setSelectedWidgetKey("");
  }

  function addWidget(widgetType: WidgetType) {
    if (!activeProfile) return;

    const defaults: Record<WidgetType, Pick<LayoutWidget,
      "width" | "height" | "fontSize" | "title" | "staticText">> = {
      TEXT: { width: 600, height: 90, fontSize: 48, title: null, staticText: "固定文字" },
      PARAMETER: { width: 420, height: 80, fontSize: 36, title: "參數", staticText: null },
      FIELD: { width: 420, height: 80, fontSize: 36, title: "欄位", staticText: null },
      CLOCK: { width: 460, height: 70, fontSize: 32, title: "時間", staticText: null },
      PAGE_INFO: { width: 360, height: 70, fontSize: 28, title: "頁數", staticText: null },
      COUNTDOWN: { width: 420, height: 70, fontSize: 28, title: "換頁倒數", staticText: null },
      TABLE: { width: 1000, height: 520, fontSize: 36, title: null, staticText: null },
    };

    const preset = defaults[widgetType];
    const width = Math.min(preset.width, activeProfile.canvasWidth);
    const height = Math.min(preset.height, activeProfile.canvasHeight);

    const widget: LayoutWidget = {
      clientKey: clientKey("widget"),
      widgetType,
      title: preset.title,
      sourceKey: null,
      staticText: preset.staticText,
      x: Math.max(0, Math.round((activeProfile.canvasWidth - width) / 2)),
      y: Math.max(0, Math.round((activeProfile.canvasHeight - height) / 2)),
      width,
      height,
      fontSize: preset.fontSize,
      alignment: "CENTER",
      config: {},
      sortOrder: activeProfile.widgets.length * 10,
    };

    setProfiles((current) => current.map((profile) =>
      profile.clientKey === activeProfile.clientKey
        ? { ...profile, widgets: [...profile.widgets, widget] }
        : profile
    ));
    setSelectedWidgetKey(widget.clientKey);
  }

  function updateSelectedWidget(patch: Partial<LayoutWidget>) {
    if (!activeProfile || !selectedWidget) return;

    setProfiles((current) => current.map((profile) => {
      if (profile.clientKey !== activeProfile.clientKey) return profile;
      return {
        ...profile,
        widgets: profile.widgets.map((widget) => {
          if (widget.clientKey !== selectedWidget.clientKey) return widget;
          const next = { ...widget, ...patch };
          return {
            ...next,
            x: Math.max(0, Math.min(next.x, profile.canvasWidth - next.width)),
            y: Math.max(0, Math.min(next.y, profile.canvasHeight - next.height)),
            width: Math.max(40, Math.min(next.width, profile.canvasWidth - next.x)),
            height: Math.max(30, Math.min(next.height, profile.canvasHeight - next.y)),
          };
        }),
      };
    }));
  }

  function deleteSelectedWidget() {
    if (!activeProfile || !selectedWidget) return;
    setProfiles((current) => current.map((profile) =>
      profile.clientKey === activeProfile.clientKey
        ? { ...profile, widgets: profile.widgets.filter((widget) => widget.clientKey !== selectedWidget.clientKey) }
        : profile
    ));
    setSelectedWidgetKey("");
  }

  function startDrag(event: ReactPointerEvent, widget: LayoutWidget) {
    if (event.button !== 0) return;
    event.preventDefault();
    setSelectedWidgetKey(widget.clientKey);
    setDrag({
      widgetKey: widget.clientKey,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: widget.x,
      startY: widget.y,
    });
  }

  function renderWidget(widget: LayoutWidget) {
    const firstRow = preview?.result.rows[0] ?? {};
    const parameters = preview?.dashboard.parameters ?? {};

    if (widget.widgetType === "TABLE") {
      const rows = (preview?.result.rows ?? []).slice(0, preview?.dashboard.pageSize ?? 5);
      return (
        <div className="layout-widget-table">
          <table>
            <thead>
              <tr>
                {visibleColumns.map((column) => <th key={column.columnName}>{column.displayLabel}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {visibleColumns.map((column) => (
                    <td key={column.columnName}>{maskText(row[column.columnName], getColumnMask(widget, column.columnName))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    let value = "";
    switch (widget.widgetType) {
      case "TEXT":
        value = widget.staticText ?? "固定文字";
        break;
      case "PARAMETER":
        value = widget.sourceKey ? textValue(parameters[widget.sourceKey]) : "選擇參數";
        break;
      case "FIELD":
        value = widget.sourceKey
          ? maskText(firstRow[widget.sourceKey], widget.config?.maskMode)
          : "選擇資料欄位";
        break;
      case "CLOCK":
        value = new Date().toLocaleString("zh-TW", { hour12: false });
        break;
      case "PAGE_INFO":
        value = "目前頁數：1 / 1";
        break;
      case "COUNTDOWN":
        value = `換頁倒數：${preview?.dashboard.pageSeconds ?? 20} 秒`;
        break;
    }

    return (
      <div className="layout-widget-value">
        {widget.title && widget.widgetType !== "TEXT" && <span className="layout-widget-title">{widget.title}</span>}
        <strong>{value}</strong>
      </div>
    );
  }

  async function saveLayout() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        profiles: profiles.map(({ clientKey: _profileKey, widgets, ...profile }) => ({
          ...profile,
          widgets: widgets.map(({ clientKey: _widgetKey, ...widget }) => widget),
        })),
      };

      const result = await apiRequest<{ profiles: Array<Omit<LayoutProfile, "clientKey" | "widgets"> & {
        widgets: Omit<LayoutWidget, "clientKey">[];
      }> }>(
        `/dashboards/${dashboardId}/layout`,
        { method: "PUT", body: JSON.stringify(payload) },
        accessToken,
      );

      const saved = result.profiles.map(withClientKeys);
      setProfiles(saved);
      setActiveProfileKey(
        saved.find((profile) => profile.isDefault)?.clientKey ?? saved[0]?.clientKey ?? "",
      );
      setSelectedWidgetKey("");
      setNotice("Dashboard 版面已儲存。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Dashboard 版面失敗。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="page-shell"><section className="notice">載入版面設計器…</section></main>;
  }

  return (
    <main className="page-shell dashboard-layout-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Dashboard Layout Designer</p>
          <h1>{preview?.dashboard.name ?? "Dashboard"}－版面設計</h1>
          <p className="subtitle">依螢幕尺寸建立不同版型；拖曳元件調整位置，使用右側屬性調整大小與內容。</p>
        </div>
        <div className="dashboard-layout-toolbar-actions">
          <Link className="secondary-button link-button" to="/designer/dashboards">返回 Dashboard</Link>
          {activeProfile?.id && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => openPlayback(activeProfile.id ?? undefined)}
            >
              播放此版型
            </button>
          )}
          <button className="primary-button" type="button" disabled={saving} onClick={() => void saveLayout()}>
            {saving ? "儲存中…" : "儲存版面"}
          </button>
        </div>
      </div>

      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      <div className="dashboard-layout-workspace">
        <aside className="layout-sidebar">
          <h2>螢幕版型</h2>
          <select
            value={activeProfileKey}
            onChange={(event) => {
              setActiveProfileKey(event.target.value);
              setSelectedWidgetKey("");
            }}
          >
            {profiles.map((profile) => (
              <option key={profile.clientKey} value={profile.clientKey}>
                {profile.isDefault ? "★ " : ""}{profile.name} ({profile.canvasWidth}×{profile.canvasHeight})
              </option>
            ))}
          </select>

          <div className="layout-profile-buttons">
            <button type="button" onClick={() => addProfile("FHD_LANDSCAPE")}>＋1920×1080</button>
            <button type="button" onClick={() => addProfile("FHD_PORTRAIT")}>＋1080×1920</button>
            <button type="button" onClick={() => addProfile("HD")}>＋1366×768</button>
          </div>

          {activeProfile && (
            <div className="layout-profile-settings">
              <label>
                版型名稱
                <input value={activeProfile.name} onChange={(e) => updateActiveProfile({ name: e.target.value })} />
              </label>
              <label>
                畫布寬度
                <input type="number" min={320} max={7680} value={activeProfile.canvasWidth}
                  onChange={(e) => updateActiveProfile({ canvasWidth: Number(e.target.value) })} />
              </label>
              <label>
                畫布高度
                <input type="number" min={240} max={4320} value={activeProfile.canvasHeight}
                  onChange={(e) => updateActiveProfile({ canvasHeight: Number(e.target.value) })} />
              </label>
              <button type="button" disabled={activeProfile.isDefault} onClick={setDefaultProfile}>設為預設</button>
              <button type="button" disabled={profiles.length <= 1} onClick={deleteProfile}>刪除版型</button>
            </div>
          )}

          <h2>新增 Widget</h2>
          <div className="layout-widget-toolbox">
            {(Object.keys(widgetLabels) as WidgetType[]).map((type) => (
              <button key={type} type="button" onClick={() => addWidget(type)}>
                ＋ {widgetLabels[type]}
              </button>
            ))}
          </div>
        </aside>

        <section className="layout-canvas-stage" ref={canvasStageRef}>
          {activeProfile && (
            <>
              <div className="layout-canvas-info">
                <div>
                  實際畫布 {activeProfile.canvasWidth} × {activeProfile.canvasHeight}　
                  設計縮放 {Math.round(scale * 100)}%
                </div>
                <div className="layout-canvas-zoom">
                  <button
                    type="button"
                    className={zoomMode === "FIT" ? "active" : ""}
                    onClick={() => setZoomMode("FIT")}
                  >
                    適合視窗
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoomMode("CUSTOM");
                      setCustomScale((current) => Math.max(0.1, current - 0.1));
                    }}
                  >
                    －
                  </button>
                  <span>{Math.round(scale * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => {
                      setZoomMode("CUSTOM");
                      setCustomScale((current) => Math.min(1.5, current + 0.1));
                    }}
                  >
                    ＋
                  </button>
                </div>
              </div>
              <div
                className="layout-canvas"
                style={{
                  width: activeProfile.canvasWidth * scale,
                  height: activeProfile.canvasHeight * scale,
                }}
              >
                <div
                  className="layout-canvas-inner"
                  style={{
                    width: activeProfile.canvasWidth,
                    height: activeProfile.canvasHeight,
                    transform: `scale(${scale})`,
                  }}
                >
                  {activeProfile.widgets.map((widget) => (
                    <div
                      key={widget.clientKey}
                      className={`layout-widget ${selectedWidgetKey === widget.clientKey ? "selected" : ""}`}
                      style={{
                        left: widget.x,
                        top: widget.y,
                        width: widget.width,
                        height: widget.height,
                        fontSize: widget.fontSize,
                        textAlign: widget.alignment.toLowerCase() as "left" | "center" | "right",
                      }}
                      onPointerDown={(event) => startDrag(event, widget)}
                    >
                      <span className="layout-widget-type">{widgetLabels[widget.widgetType]}</span>
                      {renderWidget(widget)}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        <aside className="layout-inspector">
          <h2>Widget 屬性</h2>
          {!selectedWidget && <p className="layout-hint">選取畫布上的 Widget 後即可調整。</p>}

          {selectedWidget && (
            <div className="layout-inspector-form">
              <strong>{widgetLabels[selectedWidget.widgetType]}</strong>

              <label>
                標題
                <input value={selectedWidget.title ?? ""} onChange={(e) => updateSelectedWidget({ title: e.target.value || null })} />
              </label>

              {selectedWidget.widgetType === "TEXT" && (
                <label>
                  文字內容
                  <textarea rows={3} value={selectedWidget.staticText ?? ""}
                    onChange={(e) => updateSelectedWidget({ staticText: e.target.value })} />
                </label>
              )}

              {selectedWidget.widgetType === "PARAMETER" && (
                <label>
                  Dashboard 參數
                  <select value={selectedWidget.sourceKey ?? ""}
                    onChange={(e) => updateSelectedWidget({ sourceKey: e.target.value || null })}>
                    <option value="">請選擇</option>
                    {Object.keys(preview?.dashboard.parameters ?? {}).map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                </label>
              )}

              {selectedWidget.widgetType === "FIELD" && (
                <>
                  <label>
                    資料欄位
                    <select value={selectedWidget.sourceKey ?? ""}
                      onChange={(e) => updateSelectedWidget({ sourceKey: e.target.value || null })}>
                      <option value="">請選擇</option>
                      {(preview?.result.columns ?? []).map((column) => (
                        <option key={column.name} value={column.name}>{column.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    敏感資料遮蔽
                    <select
                      value={String(selectedWidget.config?.maskMode ?? "NONE")}
                      onChange={(e) => updateSelectedWidget({
                        config: { ...selectedWidget.config, maskMode: e.target.value },
                      })}
                    >
                      {(Object.keys(maskModeLabels) as MaskMode[]).map((mode) => (
                        <option key={mode} value={mode}>{maskModeLabels[mode]}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              {selectedWidget.widgetType === "TABLE" && (
                <div className="layout-mask-settings">
                  <strong>表格欄位遮蔽</strong>
                  <p className="layout-hint">可個別設定姓名、病歷號、電話等欄位的顯示方式。</p>
                  {visibleColumns.map((column) => (
                    <label key={column.columnName}>
                      {column.displayLabel}
                      <select
                        value={getColumnMask(selectedWidget, column.columnName)}
                        onChange={(e) => {
                          const currentMasks =
                            selectedWidget.config?.columnMasks &&
                            typeof selectedWidget.config.columnMasks === "object" &&
                            !Array.isArray(selectedWidget.config.columnMasks)
                              ? selectedWidget.config.columnMasks as Record<string, unknown>
                              : {};
                          updateSelectedWidget({
                            config: {
                              ...selectedWidget.config,
                              columnMasks: {
                                ...currentMasks,
                                [column.columnName]: e.target.value,
                              },
                            },
                          });
                        }}
                      >
                        {(Object.keys(maskModeLabels) as MaskMode[]).map((mode) => (
                          <option key={mode} value={mode}>{maskModeLabels[mode]}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}

              <div className="layout-inspector-grid">
                <label>X<input type="number" value={selectedWidget.x} onChange={(e) => updateSelectedWidget({ x: Number(e.target.value) })} /></label>
                <label>Y<input type="number" value={selectedWidget.y} onChange={(e) => updateSelectedWidget({ y: Number(e.target.value) })} /></label>
                <label>寬<input type="number" min={40} value={selectedWidget.width} onChange={(e) => updateSelectedWidget({ width: Number(e.target.value) })} /></label>
                <label>高<input type="number" min={30} value={selectedWidget.height} onChange={(e) => updateSelectedWidget({ height: Number(e.target.value) })} /></label>
              </div>

              <label>
                字體大小
                <input type="number" min={8} max={240} value={selectedWidget.fontSize}
                  onChange={(e) => updateSelectedWidget({ fontSize: Number(e.target.value) })} />
              </label>

              <label>
                對齊
                <select value={selectedWidget.alignment}
                  onChange={(e) => updateSelectedWidget({ alignment: e.target.value as "LEFT" | "CENTER" | "RIGHT" })}>
                  <option value="LEFT">靠左</option>
                  <option value="CENTER">置中</option>
                  <option value="RIGHT">靠右</option>
                </select>
              </label>

              <button className="danger-button" type="button" onClick={deleteSelectedWidget}>刪除 Widget</button>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
