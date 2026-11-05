import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { patientAuditView, patientStatuses, securityGuidance, type PatientAuditView } from "../security/securityContracts";

export function DatasetPatientAuditEditor({ datasetId, revision }: { datasetId: number; revision: number }) {
  const { accessToken, hasPermission } = useAuth(); const allowed = hasPermission("DESIGN_QUERY");
  const [view, setView] = useState<PatientAuditView | null>(null), [column, setColumn] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const epoch = useRef(0);
  async function reload() {
    const seq = ++epoch.current; setBusy(true); setView(null); setConfirmed(false);
    try { const value = patientAuditView(await apiRequest(`/datasets/${datasetId}/patient-audit-config`, {}, accessToken));
      if (seq !== epoch.current) return; setView(value); setColumn(previous => value.columns.includes(previous) ? previous : "");
      setMessage("已讀取目前版本；請明確選擇並確認識別欄位。尚未變更設定。");
    } catch (error) { if (seq === epoch.current) { const safe = securityGuidance(error); setMessage(`${safe.code}：${safe.message}`); } }
    finally { if (seq === epoch.current) setBusy(false); }
  }
  useEffect(() => { setColumn(""); setMessage(""); setView(null); if (allowed) void reload(); return () => { ++epoch.current; }; }, [datasetId, revision, accessToken, allowed]);
  async function save() {
    if (!allowed || !view || busy || !confirmed || !view.columns.includes(column) || view.metadataStatus !== "CONFIRMED" || view.status === "KEY_UNAVAILABLE") return;
    const seq = ++epoch.current; setBusy(true);
    try { const value = patientAuditView(await apiRequest(`/datasets/${datasetId}/patient-audit-config`, { method: "PUT",
      body: JSON.stringify({ expectedVersion: view.version, isEnabled: true, patientKeyColumn: column, identifierConfirmed: true }) }, accessToken));
      if (seq !== epoch.current) return; setView(value); setConfirmed(false); setMessage("患者揭露稽核設定已儲存。識別碼的業務唯一性仍須由資料負責人確認。");
    } catch (error) { if (seq === epoch.current) { setView(null); setConfirmed(false); const safe = securityGuidance(error); setMessage(`${safe.code}：${safe.message}`); } }
    finally { if (seq === epoch.current) setBusy(false); }
  }
  if (!allowed) return null;
  return <section className="preview-panel" id="patient-audit-settings" aria-label="Dataset 患者揭露稽核設定">
    <h2>Dataset 患者揭露稽核設定</h2>
    <p>此區只對已儲存的 Dataset 生效，未儲存 SQL 不會成為可信 metadata。此處獨立管理揭露稽核，不修改敏感欄位遮蔽。確認儲存會啟用患者揭露稽核；不提供關閉選項，也不會自動變更設定。</p>
    <button type="button" disabled={busy} onClick={() => void reload()}>重新載入稽核版本</button>
    {view && <><p>患者揭露稽核狀態：{patientStatuses[view.status]}</p><p>目前識別欄位：{view.config?.patientKeyColumn ?? "尚未設定"}</p>
      <p>可信 metadata：{patientStatuses[view.metadataStatus]}</p>
      <label>患者識別欄位<select aria-label="患者識別欄位" value={column} disabled={busy || view.metadataStatus !== "CONFIRMED"} onChange={e => { setColumn(e.target.value); setConfirmed(false); }}>
        <option value="">請明確選擇，不會自動推定</option>{view.columns.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><input type="checkbox" checked={confirmed} disabled={busy || !column} onChange={e => setConfirmed(e.target.checked)} />我已與資料負責人確認，此欄位是穩定患者識別碼，不是姓名或電話，且具備所需業務唯一性。</label>
    </>}
    <button type="button" disabled={busy || !view || !confirmed || !column || view.metadataStatus !== "CONFIRMED" || view.status === "KEY_UNAVAILABLE"} onClick={() => void save()}>確認並儲存患者稽核設定</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
