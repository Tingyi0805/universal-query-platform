import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./SystemSettingsPage.css";

type BrandingSettings = {
  organizationName: string;
  platformName: string;
  platformTitle: string;
  platformSubtitle: string;
};

const defaults: BrandingSettings = {
  organizationName: "",
  platformName: "Universal Query Platform",
  platformTitle: "通用資料查詢與報表平台",
  platformSubtitle: "低程式碼建立查詢、報表與使用者可操作的功能入口。",
};

export function SystemSettingsPage() {
  const { accessToken } = useAuth();
  const [form, setForm] = useState<BrandingSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<BrandingSettings>("/system-settings/branding", {}, accessToken);
      setForm(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入系統設定失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/system-settings/branding", {
        method: "PUT",
        body: JSON.stringify(form),
      }, accessToken);
      setNotice("系統品牌設定已儲存。返回首頁即可看到更新後內容。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存系統設定失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">System Settings</p>
          <h1>系統設定</h1>
          <p className="subtitle">調整首頁顯示的機構名稱與平台文字。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {loading && <section className="notice">載入中…</section>}
      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      {!loading && (
        <section className="settings-card">
          <form className="settings-form" onSubmit={save}>
            <label>
              機構／公司名稱
              <input
                value={form.organizationName}
                maxLength={200}
                placeholder="例如：○○醫療財團法人"
                onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
              />
            </label>

            <label>
              平台名稱
              <input
                value={form.platformName}
                maxLength={200}
                placeholder="例如：Universal Query Platform"
                onChange={(e) => setForm({ ...form, platformName: e.target.value })}
              />
            </label>

            <label>
              平台主標題
              <input
                value={form.platformTitle}
                maxLength={200}
                placeholder="例如：通用資料查詢與報表平台"
                onChange={(e) => setForm({ ...form, platformTitle: e.target.value })}
              />
            </label>

            <label>
              平台副標題
              <textarea
                value={form.platformSubtitle}
                maxLength={500}
                rows={3}
                placeholder="例如：低程式碼建立查詢、報表與使用者可操作的功能入口。"
                onChange={(e) => setForm({ ...form, platformSubtitle: e.target.value })}
              />
            </label>

            <div className="branding-preview">
              <span>首頁預覽</span>
              <p className="preview-eyebrow">
                {[form.organizationName.trim(), form.platformName.trim()].filter(Boolean).join(" · ") || "平台名稱"}
              </p>
              <h2>{form.platformTitle.trim() || "平台主標題"}</h2>
              <p>{form.platformSubtitle.trim() || "平台副標題"}</p>
            </div>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? "儲存中…" : "儲存設定"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
