import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./SetupPage.css";

export function SetupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ bootstrapRequired: boolean; bootstrapEnabled: boolean } | null>(null);
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<{ bootstrapRequired: boolean; bootstrapEnabled: boolean }>("/admin/bootstrap/status")
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "無法讀取初始化狀態。"));
  }, []);

  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致。");
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest("/admin/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          bootstrapToken,
          username,
          displayName,
          password,
        }),
      });
      navigate("/login", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "系統管理員初始化失敗。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="setup-shell">
      <form className="setup-card" onSubmit={submit}>
        <p className="eyebrow">First-time setup</p>
        <h1>初始化系統管理員</h1>
        <p className="setup-hint">
          此功能只允許在平台尚未建立任何使用者時執行一次。
        </p>

        {error && <div className="form-error">{error}</div>}

        {status && !status.bootstrapRequired ? (
          <div className="notice">
            系統已完成初始化。<Link to="/login">返回登入</Link>
          </div>
        ) : (
          <>
            {status && !status.bootstrapEnabled && (
              <div className="form-error">
                尚未設定 BOOTSTRAP_ADMIN_TOKEN，請先在 server/.env 設定。
              </div>
            )}

            <label>Bootstrap Token
              <input type="password" autoComplete="off" value={bootstrapToken}
                onChange={(e) => setBootstrapToken(e.target.value)} />
            </label>

            <label>管理員帳號
              <input autoComplete="username" value={username}
                onChange={(e) => setUsername(e.target.value)} />
            </label>

            <label>顯示名稱
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>

            <label>密碼（至少 10 字元）
              <input type="password" autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </label>

            <label>確認密碼
              <input type="password" autoComplete="new-password" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>

            <button className="primary-button" type="submit"
              disabled={submitting || !status?.bootstrapEnabled || !bootstrapToken || !username || !displayName || password.length < 10}>
              {submitting ? "初始化中…" : "建立 SYSTEM_ADMIN"}
            </button>
          </>
        )}

        <Link className="setup-back" to="/login">返回登入頁</Link>
      </form>
    </main>
  );
}
