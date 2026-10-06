import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [bootstrapEnabled, setBootstrapEnabled] = useState(false);

  useEffect(() => {
    apiRequest<{ bootstrapRequired: boolean; bootstrapEnabled: boolean }>("/admin/bootstrap/status")
      .then((status) => {
        setBootstrapRequired(status.bootstrapRequired);
        setBootstrapEnabled(status.bootstrapEnabled);
      })
      .catch(() => {
        // Login itself will surface configuration errors when submitted.
      });
  }, []);

  if (user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");
    try {
      await login(username, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登入失敗。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Universal Query Platform</p>
        <h1>登入平台</h1>
        <p className="login-hint">請使用已授權的平台帳號登入。</p>

        {bootstrapRequired && (
          <div className="notice">
            平台尚未建立第一位管理員。
            {bootstrapEnabled
              ? <> <Link to="/setup">進行首次設定</Link></>
              : <> 請先在伺服器設定 <code>BOOTSTRAP_ADMIN_TOKEN</code>。</>}
          </div>
        )}

        <label>
          帳號
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
          />
        </label>

        <label>
          密碼
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        <button type="submit" disabled={submitting || !username || !password}>
          {submitting ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}
