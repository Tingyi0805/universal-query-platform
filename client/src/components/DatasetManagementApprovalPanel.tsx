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
type NonPatientReview = {
  expectedDefinitionVersion: string;
  expectedSourceVersion: string;
  expectedPolicyVersion: number;
  available: boolean;
  columns: {name:string;dataType:string|null;ordinal:number}[];
  note:string;
};
type ReviewDecision = "PENDING"|"GENERAL"|"MASK_ALL"|"HIDE";
const reviewOptions = [
  {value:"PENDING",label:"尚未確認"},
  {value:"GENERAL",label:"一般資料（原樣顯示）"},
  {value:"MASK_ALL",label:"全部遮蔽"},
  {value:"HIDE",label:"不顯示"},
] as const;
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
  const [review, setReview] = useState<NonPatientReview | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string,ReviewDecision>>({});
  const [noPatientConfirmed, setNoPatientConfirmed] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
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
    setReview(null); setReviewOpen(false); setReviewDecisions({});
    setNoPatientConfirmed(false); setReviewMessage("");
    void reload();
  }, [reload, revision]);

  async function openSafetyReview() {
    if (!admin || busy || reviewBusy || !canSubmit) return;
    setReviewBusy(true); setReviewMessage(""); setReview(null);
    setNoPatientConfirmed(false); setReviewDecisions({});
    try {
      const result=await apiRequest<NonPatientReview>(
        "/datasets/" + datasetId + "/management-approval/safety-review", {}, accessToken);
      setReview(result); setReviewOpen(true);
      if (!result.available) setReviewMessage(result.columns.length===0
        ? "尚無設計用欄位清單；請先取得欄位並儲存候選欄位清單。"
        : result.note);
    } catch (e) {
      setReviewMessage(e instanceof Error ? e.message : "無法讀取安全審查狀態。");
    } finally { setReviewBusy(false); }
  }
  async function saveSafetyReview() {
    if (!admin || !canSubmit || busy || reviewBusy || !review?.available
        || !noPatientConfirmed || !review.columns.length
        || review.columns.some(c=>!reviewDecisions[c.name] || reviewDecisions[c.name]==="PENDING")) return;
    if (!window.confirm("確認這筆 Dataset 不含患者資料，且已逐欄審查原樣顯示／遮蔽／隱藏的選擇？此操作會寫入有稽核的安全政策。")) return;
    setReviewBusy(true); setReviewMessage("");
    try {
      const body={
        expectedDefinitionVersion:review.expectedDefinitionVersion,
        expectedSourceVersion:review.expectedSourceVersion,
        expectedPolicyVersion:0,
        requestId:crypto.randomUUID(), confirmedNoPatientData:true,
        columns:review.columns.map(c=>({columnName:c.name,decision:reviewDecisions[c.name]})),
      };
      await apiRequest("/datasets/" + datasetId + "/management-approval/safety-review",
        {method:"PUT",body:JSON.stringify(body)},accessToken);
      setReview(null); setReviewOpen(false); setNoPatientConfirmed(false);
      setReviewMessage("安全審查已儲存；資料預覽仍須通過使用核准、即時版本、來源及稽核檢查。患者資料不得使用本流程。");
      await reload();
    } catch(e) {
      // A write may have committed even if the network failed. Do not auto-retry.
      setReview(null); setReviewOpen(false); setNoPatientConfirmed(false);
      setReviewMessage((e instanceof Error?e.message:"安全審查結果不明。")
        + " 請重新讀取核准狀態查核，勿直接重送。");
    } finally { setReviewBusy(false); }
  }

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
    {admin && <section aria-label="管理者簡化安全審查" className="preview-panel">
      <h3>管理者簡化安全審查</h3>
      <p>適用於已確認不含患者資料的 Dataset。需逐欄明確選擇「一般顯示／全部遮蔽／不顯示」，不會自動判定任何欄位安全；患者資料仍須完成專用識別及揭露稽核審查。</p>
      <button type="button" className="secondary-button" disabled={!canSubmit || busy || reviewBusy}
        onClick={()=>void openSafetyReview()}>{reviewBusy?"處理中…":"開啟簡化安全審查（一般非患者資料）"}</button>
      {reviewOpen && review && <>
        <p role="status">{review.note}</p>
        {review.available && <>
          <table className="preview-table" aria-label="安全審查欄位清單"><thead><tr>
            <th>欄位名稱</th><th>SQL 型別</th><th>保護方式</th>
          </tr></thead><tbody>
          {review.columns.map(column=><tr key={column.name}>
            <td>{column.name}</td><td>{column.dataType??"未知"}</td>
            <td><select aria-label={`欄位 ${column.name} 的保護方式`}
              value={reviewDecisions[column.name]??"PENDING"}
              onChange={e=>setReviewDecisions(prev=>({...prev,[column.name]:e.target.value as ReviewDecision}))}>
                {reviewOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select></td>
          </tr>)}
          </tbody></table>
          <label className="dataset-public-policy-confirm">
            <input type="checkbox" checked={noPatientConfirmed}
              onChange={e=>setNoPatientConfirmed(e.target.checked)} />
            我已核對 SQL、資料來源與上述全部欄位，確認這筆 Dataset 不包含患者資料，也沒有未標示的敏感欄位。
          </label>
          <button type="button" className="primary-button"
            disabled={reviewBusy || busy || !noPatientConfirmed || review.columns.some(c=>
              !reviewDecisions[c.name] || reviewDecisions[c.name]==="PENDING")}
            onClick={()=>void saveSafetyReview()}>確認並儲存一般資料安全審查</button>
        </>}
      </>}
      {reviewMessage && <p role="status">{reviewMessage}</p>}
    </section>}
    {!canSubmit && admin && <p role="status">請先儲存 Dataset 變更，再核准使用或播放。</p>}
    <p>新欄位、未審查的患者資料或未完成遮蔽規則不會自動公開；變更 SQL 或安全設定後需重新審查。</p>
    {admin && <button type="button" className="secondary-button" disabled={busy} onClick={() => void reload()}>重新讀取核准狀態</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
