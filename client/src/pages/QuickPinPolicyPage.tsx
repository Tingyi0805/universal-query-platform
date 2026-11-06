import { configuredPinLength } from "../security/pinPolicy";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AdminUsersPage.css";
import "./WorkstationManagement.css";

export function QuickPinPolicyPanel() {
  const { accessToken } = useAuth();
  const identity=useRef(0);
  const [length, setLength] = useState(6);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const epoch=++identity.current;setLoading(true);setReadFailed(false);setError("");setNotice("");
    apiRequest<{ pinLength: number }>("/admin/quick-pin-policy", {}, accessToken,()=>identity.current===epoch)
      .then((result) => {if(identity.current===epoch)setLength(configuredPinLength(result.pinLength));})
      .catch(()=>{if(identity.current===epoch){setReadFailed(true);setError("讀取 PIN 政策失敗或內容無效，禁止修改。");}})
      .finally(() => {if(identity.current===epoch)setLoading(false);});
    return()=>{++identity.current;};
  }, [accessToken]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if(loading||readFailed||saving)return;
    const epoch=identity.current;
    if (!window.confirm("修改 PIN 長度會停用所有已註冊的 PIN，員工須重新設定。確定繼續？")) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await apiRequest("/admin/quick-pin-policy", { method: "PUT", body: JSON.stringify({ pinLength: configuredPinLength(length) }) }, accessToken,()=>identity.current===epoch);
      if(identity.current!==epoch)return;
      setNotice("PIN 長度政策已更新。已註冊的 PIN 需重新設定。");
    } catch (err) {
      if(identity.current===epoch)setError("政策更新未完成，請重新載入確認；不會自動重送。");
    } finally { setSaving(false); }
  }

  return <section className="pin-panel" aria-label="PIN 安全設定">
    <div className="page-toolbar"><div><p className="eyebrow">Security</p><h2>PIN 安全設定</h2><p className="subtitle">設定全系統統一的個人 PIN 位數。</p></div></div>
    {error && <section className="form-error" role="alert">{error}</section>}
    {notice && <section className="notice" role="status">{notice}</section>}
    <section className="admin-section">
      {loading ? <p>載入中…</p> : readFailed ? <p>政策讀取失敗，請重新載入頁面後再修改。</p> : <form className="admin-form" onSubmit={save}>
        <label>PIN 長度
          <select value={length} onChange={e => setLength(Number(e.target.value))}>
            {Array.from({ length: 9 }, (_, i) => i + 4).map(n => <option key={n} value={n}>{n} 位數</option>)}
          </select>
        </label>
        <p>建議至少 6 位數；4～5 位數安全性較低。修改長度會使現有 PIN 失效；員工必須使用正式密碼重新註冊。PIN 快速登入尚未啟用。</p>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存 PIN 長度"}</button>
      </form>}
    </section>
  </section>;
}
