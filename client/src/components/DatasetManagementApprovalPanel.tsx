import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type ApprovalStatus = {
  usage: { active: boolean; definitionVersion: string };
  previewSafety?: {
    status: "BLOCKED" | "POLICY_CONFIRMED";
    code: string;
    message: string;
  };
  playback: {
    status: "APPROVED" | "UNAPPROVED" | "STALE" | "BLOCKED";
    permittedColumns: number;
    message: string;
  };
};
const playbackLabel = {
  APPROVED: "已核准",
  UNAPPROVED: "未核准",
  STALE: "需重新核准",
  BLOCKED: "安全條件尚未具備",
} as const;

export function DatasetManagementApprovalPanel({
  datasetId, revision, canSubmit, onUpdated,
}: {
  datasetId: number; revision: number; canSubmit: boolean; onUpdated: () => Promise<void>;
}) {
  const { accessToken, hasPermission } = useAuth();
  const admin = hasPermission("MANAGE_USERS") && hasPermission("DESIGN_QUERY");
  const [status, setStatus] = useState<ApprovalStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useCallback(async () => {
    if (!admin) return;
    setBusy(true);
    try {
      const result = await apiRequest<ApprovalStatus>(
        "/datasets/" + datasetId + "/management-approval", {}, accessToken
      );
      setStatus(result);
    } catch (e) {
      setStatus(null);
      setMessage(e instanceof Error ? e.message : "無法載入核准狀態。");
    } finally {
      setBusy(false);
    }
  }, [admin, datasetId, accessToken]);
  useEffect(() => {
    setStatus(null); setMessage("");
    void reload();
  }, [reload, revision]);

  async function setUsage(approve: boolean) {
    if (!admin || !status || !canSubmit || busy) return;
    const prompt = approve
      ? "確認允許此 Dataset 用於已授權 Query？核准不會自動發佈 Query。"
      : "確認停止此 Dataset 的查詢使用？相關 Query 將取消發佈。";
    if (!window.confirm(prompt)) return;
    setBusy(true); setMessage("");
    try {
      await apiRequest(
        "/datasets/" + datasetId + "/management-approval/usage",
        { method: "PUT", body: JSON.stringify({
          approve, expectedVersion: status.usage.definitionVersion,
        }) },
        accessToken,
      );
      setMessage(approve ? "已核准使用；仍須符合 Query 發佈及使用者權限。" : "已停止使用，並取消相關 Query 發佈。");
      await onUpdated();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "核准未完成，資料維持原狀。");
    } finally {
      setBusy(false);
      void reload();
    }
  }
  async function setPlayback(approve: boolean) {
    if (!admin || !status || !canSubmit || busy || status.playback.status === "BLOCKED") return;
    if (!window.confirm(approve
      ? "確認核准已通過安全規則的欄位供 Dashboard 播放？未審核及敏感原值仍禁止公開。"
      : "確認停止此 Dataset 的公共顯示資料交付？")) return;
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ status: string; permittedColumns: number }>(
        "/datasets/" + datasetId + "/management-approval/playback",
        { method: "PUT", body: JSON.stringify({ approve, requestId: crypto.randomUUID() }) },
        accessToken,
      );
      setMessage(approve
        ? "已核准 " + result.permittedColumns + " 個安全欄位；裝置與 Dashboard 仍需符合各自授權。"
        : "已停止此 Dataset 的公共欄位交付。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "播放核准未完成，維持拒絕。");
    } finally {
      setBusy(false);
      void reload();
    }
  }

  return <section className="preview-panel" aria-label="Dataset 使用與播放核准">
    <h2>Dataset 使用與播放核准</h2>
    <p>只需由管理者核准用途；欄位遮蔽、患者揭露稽核及播放裝置權限仍由系統檢查，不會因核准而略過。</p>
    {!admin
      ? <p role="status">核准與撤銷由系統管理者處理。</p>
      : !status
      ? <p role="status">{busy ? "讀取核准狀態中…" : "核准狀態未就緒，請重新載入。"}</p>
      : <>
        <div className="dataset-management-approval-row">
          <div>
            <strong>允許登入使用</strong>
            <p>狀態：{status.usage.active ? "已啟用" : "未核准"}</p>
          </div>
          <button type="button" disabled={busy || !canSubmit}
            onClick={() => void setUsage(!status.usage.active)}>
            {status.usage.active ? "停止使用" : "核准使用"}
          </button>
        </div>
        <div className="dataset-management-approval-row" role="group" aria-label="資料預覽安全狀態">
          <div>
            <strong>執行預覽前的安全確認</strong>
            <p>狀態：{status.previewSafety?.status === "POLICY_CONFIRMED" ? "欄位政策已確認" : "尚不可預覽"}</p>
            <p role="status">{status.previewSafety?.message ?? "請重新載入安全核准狀態。"}</p>
          </div>
        </div>
        <div className="dataset-management-approval-row">
          <div>
            <strong>允許 Dashboard 播放</strong>
            <p>狀態：{playbackLabel[status.playback.status]}
              {status.playback.status === "APPROVED" ? "（" + status.playback.permittedColumns + " 個允許欄位）" : ""}
            </p>
            {status.playback.message && <p role="status">{status.playback.message}</p>}
          </div>
          <button type="button"
            disabled={busy || !canSubmit || !status.usage.active || status.playback.status === "BLOCKED"}
            onClick={() => void setPlayback(status.playback.status !== "APPROVED")}>
            {status.playback.status === "APPROVED" ? "停止播放" : "核准播放"}
          </button>
        </div>
      </>}
    {!canSubmit && admin && <p role="status">請先儲存 Dataset 變更，再核准使用或播放。</p>}
    <p>新欄位、未審查的患者資料或未完成遮蔽規則不會自動公開；變更 SQL 或安全設定後需重新審查。</p>
    {admin && <button type="button" className="secondary-button" disabled={busy} onClick={() => void reload()}>重新讀取核准狀態</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
