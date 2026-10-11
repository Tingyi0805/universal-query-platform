import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AdminUsersPage.css";

export function QuickPinPolicyPage() {
  const { accessToken } = useAuth();
  const [length, setLength] = useState(6);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    apiRequest<{ pinLength: number }>("/admin/quick-pin-policy", {}, accessToken)
      .then((result) => setLength(result.pinLength))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "讀取 PIN 政策失敗"))
      .finally(() => setLoading(false));
  }, [accessToken]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm("修改 PIN 長度會停用所有已註冊的 PIN，員工須重新設定。確定繼續？")) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await apiRequest("/admin/quick-pin-policy", { method: "PUT", body: JSON.stringify({ pinLength: length }) }, accessToken);
      setNotice("PIN 長度政策已更新。已註冊的 PIN 需重新設定。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally { setSaving(false); }
  }

  return <main className="page-shell">
    <div className="page-toolbar"><div><p className="eyebrow">Security</p><h1>員工 PIN 長度設定</h1><p className="subtitle">設定全系統統一的個人 PIN 位數。</p></div><Link className="secondary-button link-button" to="/admin/users">返回使用者管理</Link></div>
    {error && <section className="form-error" role="alert">{error}</section>}
    {notice && <section className="notice" role="status">{notice}</section>}
    <section className="admin-section">
      {loading ? <p>載入中…</p> : <form className="admin-form" onSubmit={save}>
        <label>PIN 長度
          <select value={length} onChange={e => setLength(Number(e.target.value))}>
            {Array.from({ length: 9 }, (_, i) => i + 4).map(n => <option key={n} value={n}>{n} 位數</option>)}
          </select>
        </label>
        <p>建議至少 6 位數；4～5 位數安全性較低。修改長度會使現有 PIN 失效；員工必須使用正式密碼重新註冊。PIN 快速登入尚未啟用。</p>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存 PIN 長度"}</button>
      </form>}
    </section>
  </main>;
}
