import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function ChangePasswordPage() {
  const { accessToken, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 10) {
      setError("新密碼至少需要 10 個字元。");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("新密碼與確認密碼不一致。");
      return;
    }

    setSaving(true);
    try {
      await apiRequest("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }, accessToken);

      logout();
      navigate("/login", {
        replace: true,
        state: { notice: "密碼已變更，請使用新密碼重新登入。" },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "變更密碼失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-shell">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Account Security</p>
          <h1>變更密碼</h1>
          <p className="subtitle">僅適用於 LOCAL 本機帳號。變更成功後會自動登出。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}

      <section className="admin-section">
        <form className="admin-form" onSubmit={submit}>
          <label>
            目前密碼
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>

          <label>
            新密碼
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 10 個字元"
            />
          </label>

          <label>
            確認新密碼
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "變更中…" : "變更密碼"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
