import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type ApprovalStatus = {
  usage: { active: boolean; definitionVersion: string };
  playback?: { status: "APPROVED" | "UNAPPROVED" | "STALE" | "BLOCKED"; permittedColumns: number; message: string };
  previewSafety?: {
    status: "BLOCKED" | "POLICY_CONFIRMED" | "MANAGER_APPROVED";
    code: string;
    message: string;
  };
};

// Web Crypto getRandomValues also works on ordinary HTTP intranet origins.
function approvalRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}

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
    setStatus(null);
    setMessage("");
    void reload();
  }, [reload, revision]);

  async function setUsage(approve: boolean) {
    if (!admin || !status || !canSubmit || busy) return;
    const prompt = approve
      ? "確認核准此 Dataset 使用？新建 Dataset 的管理者預覽將顯示 SQL 原始輸出，請先確認 SQL 僅回傳必要資料。核准不會自動發佈 Query 或開放公共播放。"
      : "確認停止此 Dataset 的查詢使用？相關 Query 將取消發佈。";
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(
        "/datasets/" + datasetId + "/management-approval/usage",
        { method: "PUT", body: JSON.stringify({
          approve, expectedVersion: status.usage.definitionVersion,
        }) },
        accessToken,
      );
      setMessage(approve
        ? "已核准使用；請確認下方預覽狀態。"
        : "已停止使用，並取消相關 Query 發佈。");
      await onUpdated();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "核准未完成，資料維持原狀。");
    } finally {
      setBusy(false);
      void reload();
    }
  }

  async function setPlayback(approve: boolean) {
    if (!admin || !hasPermission("EXECUTE_QUERY") || !status?.usage.active || !canSubmit || busy ||
        status.playback?.status === "BLOCKED" || !status.playback) return;
    if (!window.confirm(approve
      ? "確認核准此 Dataset 公共播放？公開內容仍依系統現有資料保護政策處理。"
      : "確認撤銷此 Dataset 公共播放授權？")) return;
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/datasets/" + datasetId + "/management-approval/playback",
        { method: "PUT", body: JSON.stringify({ approve, requestId: approvalRequestId() }) }, accessToken);
      setMessage(approve ? "已核准公共播放。" : "已撤銷公共播放授權。");
      await onUpdated();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "播放授權未完成。");
    } finally {
      setBusy(false);
      void reload();
    }
  }

  return <section className="preview-panel" aria-label="Dataset 使用核准">
    <h2>Dataset 使用核准</h2>
    <p>管理者只需核准或停止使用；敏感欄位遮蔽、患者揭露稽核與 Dashboard 裝置權限由系統依現有安全規則檢查，不需要逐欄選擇顯示方式。</p>
    {!admin
      ? <p role="status">核准與撤銷由系統管理者處理。</p>
      : !status
      ? <p role="status">{busy ? "讀取核准狀態中…" : "核准狀態未就緒，請重新載入。"}</p>
      : <>
        <div className="dataset-management-approval-row">
          <div>
            <strong>允許使用</strong>
            <p>狀態：{status.usage.active ? "已啟用" : "未核准"}</p>
          </div>
          <button type="button" disabled={busy || !canSubmit}
            onClick={() => void setUsage(!status.usage.active)}>
            {status.usage.active ? "停止使用" : "核准使用"}
          </button>
        </div>
        <div className="dataset-management-approval-row" role="group" aria-label="公共播放核准">
          <div>
            <strong>允許公共播放</strong>
            <p>狀態：{status.playback?.status === "APPROVED" ? "已核准" :
              status.playback?.status === "STALE" ? "需重新核准" :
              status.playback?.status === "UNAPPROVED" ? "未核准" : "尚未具備播放條件"}</p>
            <p role="status">{status.playback?.message}</p>
          </div>
          <button type="button" disabled={busy || !canSubmit || !hasPermission("EXECUTE_QUERY") ||
            !status.usage.active || !status.playback || status.playback.status === "BLOCKED"}
            onClick={() => void setPlayback(status.playback?.status !== "APPROVED")}>
            {status.playback?.status === "APPROVED" ? "撤銷播放核准" : "核准公共播放"}
          </button>
        </div>
        <div className="dataset-management-approval-row" role="group" aria-label="資料預覽安全狀態">
          <div>
            <strong>系統安全檢查（唯讀）</strong>
            <p>資料預覽：{status.previewSafety?.status === "POLICY_CONFIRMED"
              ? "欄位政策已確認" : status.previewSafety?.status === "MANAGER_APPROVED"
                ? "管理者已核准預覽" : "安全條件尚未具備"}</p>
            <p role="status">{status.previewSafety?.message ?? "請重新讀取安全狀態。"}</p>
            <p>核准使用不會自動公開未通過安全檢查的資料，也不會自動核准 Dashboard 公共播放。</p>
          </div>
        </div>
      </>}
    {!canSubmit && admin && <p role="status">請先儲存 Dataset 變更，再核准使用。</p>}
    {admin && <button type="button" className="secondary-button"
      disabled={busy} onClick={() => void reload()}>重新讀取核准狀態</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
