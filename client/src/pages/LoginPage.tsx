import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { user, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
