import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./SystemSettingsPage.css";

type AuditRetentionSettings = {
  onlineRetentionDays: number;
  archiveRetentionDays: number;
  importantPermanent: boolean;
};

type AuditLifecyclePreview = AuditRetentionSettings & {
  archiveCount: number;
  deleteCount: number;
};

type VersionRetentionSettings = {
  retentionCount: number;
  retentionDays: number;
};

type CleanupPreview = VersionRetentionSettings & {
  datasetDeleteCount: number;
  queryDeleteCount: number;
  totalDeleteCount: number;
};

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
  const [auditRetention, setAuditRetention] = useState<AuditRetentionSettings>({
    onlineRetentionDays: 365,
    archiveRetentionDays: 1825,
    importantPermanent: true,
  });
  const [auditPreview, setAuditPreview] = useState<AuditLifecyclePreview | null>(null);
  const [retention, setRetention] = useState<VersionRetentionSettings>({
    retentionCount: 30,
    retentionDays: 365,
  });
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [savingAuditRetention, setSavingAuditRetention] = useState(false);
  const [archivingAudit, setArchivingAudit] = useState(false);
  const [cleaningAudit, setCleaningAudit] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [brandingResult, retentionResult, cleanupResult, auditRetentionResult, auditPreviewResult] = await Promise.all([
        apiRequest<BrandingSettings>("/system-settings/branding", {}, accessToken),
        apiRequest<VersionRetentionSettings>("/system-settings/version-retention", {}, accessToken),
        apiRequest<CleanupPreview>("/system-settings/version-retention/cleanup-preview", {}, accessToken),
        apiRequest<AuditRetentionSettings>("/system-settings/audit-retention", {}, accessToken),
        apiRequest<AuditLifecyclePreview>("/system-settings/audit-retention/lifecycle-preview", {}, accessToken),
      ]);
      setForm(brandingResult);
      setRetention(retentionResult);
      setCleanupPreview(cleanupResult);
      setAuditRetention(auditRetentionResult);
      setAuditPreview(auditPreviewResult);
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

  async function refreshCleanupPreview() {
    try {
      const result = await apiRequest<CleanupPreview>(
        "/system-settings/version-retention/cleanup-preview",
        {},
        accessToken,
      );
      setCleanupPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入版本清理資訊失敗。");
    }
  }

  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    setSavingRetention(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/system-settings/version-retention", {
        method: "PUT",
        body: JSON.stringify(retention),
      }, accessToken);
      setNotice("版本保留策略已儲存。");
      await refreshCleanupPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存版本保留策略失敗。");
    } finally {
      setSavingRetention(false);
    }
  }

  async function cleanupVersions() {
    const count = cleanupPreview?.totalDeleteCount ?? 0;
    if (count <= 0) {
      setNotice("目前沒有符合清理條件的舊版本。");
      return;
    }

    if (!window.confirm(
      `目前有 ${count} 個舊版本符合清理條件。\n每月最後一版、Pinned 與 Published Snapshot 不會刪除。\n\n確定執行清理？`,
    )) return;

    setCleaning(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{
        datasetDeletedCount: number;
        queryDeletedCount: number;
        totalDeletedCount: number;
      }>("/system-settings/version-retention/cleanup", {
        method: "POST",
      }, accessToken);

      setNotice(
        `版本清理完成：Dataset ${result.datasetDeletedCount} 版、Query ${result.queryDeletedCount} 版，共 ${result.totalDeletedCount} 版。`,
      );
      await refreshCleanupPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "版本清理失敗。");
    } finally {
      setCleaning(false);
    }
  }

  async function refreshAuditPreview() {
    try {
      const result = await apiRequest<AuditLifecyclePreview>("/system-settings/audit-retention/lifecycle-preview", {}, accessToken);
      setAuditPreview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Audit 生命週期資訊失敗。");
    }
  }

  async function saveAuditRetention(event: FormEvent) {
    event.preventDefault();
    setSavingAuditRetention(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/system-settings/audit-retention", {
        method: "PUT",
        body: JSON.stringify(auditRetention),
      }, accessToken);
      setNotice("Audit 保留策略已儲存。");
      await refreshAuditPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Audit 保留策略失敗。");
    } finally {
      setSavingAuditRetention(false);
    }
  }

  async function archiveAuditLogs() {
    const count = auditPreview?.archiveCount ?? 0;
    if (count <= 0) {
      setNotice("目前沒有符合封存條件的 Audit Log。");
      return;
    }
    if (!window.confirm(`目前有 ${count} 筆 Audit Log 可移至 Archive。確定執行？`)) return;

    setArchivingAudit(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ archivedCount: number }>("/system-settings/audit-retention/archive", { method: "POST" }, accessToken);
      setNotice(`Audit 封存完成，共移轉 ${result.archivedCount} 筆。`);
      await refreshAuditPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit 封存失敗。");
    } finally {
      setArchivingAudit(false);
    }
  }

  async function cleanupAuditArchive() {
    const count = auditPreview?.deleteCount ?? 0;
    if (count <= 0) {
      setNotice("目前沒有符合清理條件的 Archive Audit。");
      return;
    }
    if (!window.confirm(
      `目前有 ${count} 筆 Archive Audit 符合清理條件。\n重要 Audit 會依目前策略保留。\n\n確定清理？`,
    )) return;

    setCleaningAudit(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ deletedCount: number }>("/system-settings/audit-retention/archive/cleanup", { method: "POST" }, accessToken);
      setNotice(`Audit Archive 清理完成，共刪除 ${result.deletedCount} 筆到期資料。`);
      await refreshAuditPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit Archive 清理失敗。");
    } finally {
      setCleaningAudit(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">System Settings</p>
          <h1>系統設定</h1>
          <p className="subtitle">調整平台品牌文字與版本保留策略。</p>
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

      {!loading && (
        <section className="settings-card version-retention-card">
          <div className="section-title">
            <div>
              <h2>版本保留策略</h2>
              <p className="settings-hint">
                最近版本與保留天數同時受到保護；每月最後一版、Pinned 與 Published Snapshot 都不會被清理。
              </p>
            </div>
          </div>

          <form className="settings-form" onSubmit={saveRetention}>
            <div className="retention-grid">
              <label>
                每個項目最近保留版本數
                <input
                  type="number"
                  min={5}
                  max={500}
                  value={retention.retentionCount}
                  onChange={(e) => setRetention({
                    ...retention,
                    retentionCount: Number(e.target.value),
                  })}
                />
                <small>預設 30；不論版本日期多舊，最近這些版本都不刪除。</small>
              </label>

              <label>
                一般版本至少保留天數
                <input
                  type="number"
                  min={30}
                  max={3650}
                  value={retention.retentionDays}
                  onChange={(e) => setRetention({
                    ...retention,
                    retentionDays: Number(e.target.value),
                  })}
                />
                <small>預設 365 天；只有超過此天數且超出最近保留數的版本才可清理。</small>
              </label>
            </div>

            <div className="retention-summary">
              <strong>目前可清理</strong>
              <span>Dataset：{cleanupPreview?.datasetDeleteCount ?? 0} 版</span>
              <span>Query：{cleanupPreview?.queryDeleteCount ?? 0} 版</span>
              <span>合計：{cleanupPreview?.totalDeleteCount ?? 0} 版</span>
            </div>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={savingRetention}>
                {savingRetention ? "儲存中…" : "儲存保留策略"}
              </button>
              <button className="secondary-button" type="button" onClick={() => void refreshCleanupPreview()}>
                重新計算
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={cleaning || (cleanupPreview?.totalDeleteCount ?? 0) === 0}
                onClick={() => void cleanupVersions()}
              >
                {cleaning ? "清理中…" : "清理舊版本"}
              </button>
            </div>
          </form>
        </section>
      )}
      {!loading && (
        <section className="settings-card version-retention-card">
          <div className="section-title">
            <div>
              <h2>Audit Log 保留策略</h2>
              <p className="settings-hint">
                線上 Audit 到期後先移入 Archive；Archive 到期後才清理。重要 Audit 可設定永久保留。
              </p>
            </div>
          </div>

          <form className="settings-form" onSubmit={saveAuditRetention}>
            <div className="retention-grid">
              <label>
                線上 Audit 保留天數
                <input
                  type="number"
                  min={30}
                  max={3650}
                  value={auditRetention.onlineRetentionDays}
                  onChange={(e) => setAuditRetention({
                    ...auditRetention,
                    onlineRetentionDays: Number(e.target.value),
                  })}
                />
                <small>預設 365 天；到期資料會先封存，不直接刪除。</small>
              </label>

              <label>
                Archive 保留天數
                <input
                  type="number"
                  min={365}
                  max={7300}
                  value={auditRetention.archiveRetentionDays}
                  onChange={(e) => setAuditRetention({
                    ...auditRetention,
                    archiveRetentionDays: Number(e.target.value),
                  })}
                />
                <small>預設 1825 天（5 年）。</small>
              </label>
            </div>

            <label className="inline-check">
              <input
                type="checkbox"
                checked={auditRetention.importantPermanent}
                onChange={(e) => setAuditRetention({
                  ...auditRetention,
                  importantPermanent: e.target.checked,
                })}
              />
              重要 Audit 永久保留
            </label>

            <div className="retention-summary">
              <strong>目前 Audit 生命週期狀態</strong>
              <span>可移至 Archive：{auditPreview?.archiveCount ?? 0} 筆</span>
              <span>Archive 可清理：{auditPreview?.deleteCount ?? 0} 筆</span>
            </div>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={savingAuditRetention}>
                {savingAuditRetention ? "儲存中…" : "儲存 Audit 策略"}
              </button>
              <button className="secondary-button" type="button" onClick={() => void refreshAuditPreview()}>
                重新計算
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={archivingAudit || (auditPreview?.archiveCount ?? 0) === 0}
                onClick={() => void archiveAuditLogs()}
              >
                {archivingAudit ? "封存中…" : "封存到期 Audit"}
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={cleaningAudit || (auditPreview?.deleteCount ?? 0) === 0}
                onClick={() => void cleanupAuditArchive()}
              >
                {cleaningAudit ? "清理中…" : "清理到期 Archive"}
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
