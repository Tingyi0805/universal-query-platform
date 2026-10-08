import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./VersionHistoryPanel.css";

type VersionItem = {
  id: number;
  versionNo: number;
  reason: string | null;
  createdAtUtc: string;
  createdByUserId: number | null;
  createdByUsername: string | null;
  createdByDisplayName: string | null;
};

const reasonLabels: Record<string, string> = {
  DATASET_UPDATE: "Dataset 修改",
  PARAMETER_UPDATE: "Parameter 修改",
  QUERY_UPDATE: "Query 修改",
  REPORT_UPDATE: "Report 修改",
};

function reasonLabel(reason: string | null) {
  if (!reason) return "版本快照";
  if (reason.startsWith("RESTORE_FROM_V")) {
    return `還原前備份（來源 ${reason.replace("RESTORE_FROM_", "")}）`;
  }
  return reasonLabels[reason] ?? reason;
}

export function VersionHistoryPanel({
  basePath,
  entityLabel,
  refreshKey = 0,
  disabled = false,
  onRestored,
}: {
  basePath: string;
  entityLabel: string;
  refreshKey?: number;
  disabled?: boolean;
  onRestored?: () => void | Promise<void>;
}) {
  const { accessToken } = useAuth();
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ versions: VersionItem[] }>(
        `${basePath}/versions`,
        {},
        accessToken,
      );
      setVersions(result.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入版本紀錄失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, basePath]);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, load, refreshKey]);

  async function restore(version: VersionItem) {
    if (disabled) return;
    if (!window.confirm(
      `確定將 ${entityLabel} 還原到 V${version.versionNo}？\n\n目前設定會先自動建立一個新版本，還原後會維持停用 / 未發佈狀態。`,
    )) return;

    setRestoring(version.versionNo);
    setError("");
    setNotice("");
    try {
      await apiRequest(
        `${basePath}/versions/${version.versionNo}/restore`,
        { method: "POST" },
        accessToken,
      );
      setNotice(`已還原至 V${version.versionNo}，請確認內容後再啟用或發佈。`);
      await load();
      await onRestored?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "版本還原失敗。");
    } finally {
      setRestoring(null);
    }
  }

  return (
    <section className="version-history-panel">
      <div className="section-title">
        <div>
          <h2>版本紀錄</h2>
          <p>修改前會自動建立 Snapshot；還原本身也會先備份目前狀態。</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setExpanded((current) => !current);
            if (!expanded) void load();
          }}
        >
          {expanded ? "收合版本" : "查看版本"}
        </button>
      </div>

      {expanded && (
        <>
          {error && <div className="form-error">{error}</div>}
          {notice && <div className="notice">{notice}</div>}

          {loading ? (
            <div className="notice">版本載入中…</div>
          ) : versions.length === 0 ? (
            <div className="empty-state">目前尚無版本紀錄；第一次修改後會自動建立 V1。</div>
          ) : (
            <div className="version-list">
              {versions.map((version) => (
                <div className="version-row" key={version.id}>
                  <div>
                    <strong>V{version.versionNo}</strong>
                    <span>{reasonLabel(version.reason)}</span>
                  </div>
                  <div className="version-meta">
                    <span>{new Date(version.createdAtUtc).toLocaleString("zh-TW")}</span>
                    <span>
                      {version.createdByDisplayName || version.createdByUsername || "系統"}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={disabled || restoring !== null}
                    onClick={() => void restore(version)}
                  >
                    {restoring === version.versionNo ? "還原中…" : "還原此版"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
