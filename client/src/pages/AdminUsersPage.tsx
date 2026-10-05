import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type UserRow = {
  id: number;
  username: string;
  displayName: string;
  authProvider: string;
  isActive: boolean;
  roles: string[];
};

export function AdminUsersPage() {
  const { accessToken } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ users: UserRow[] }>("/admin/users", {}, accessToken)
      .then((result) => setUsers(result.users))
      .catch((e) => setError(e instanceof Error ? e.message : "載入失敗。"))
      .finally(() => setLoading(false));
  }, [accessToken]);

  return (
    <main className="page-shell">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>使用者與角色</h1>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {loading && <section className="notice">載入中…</section>}
      {error && <section className="form-error">{error}</section>}

      {!loading && !error && (
        <section className="table-card">
          <table>
            <thead>
              <tr>
                <th>帳號</th>
                <th>顯示名稱</th>
                <th>驗證來源</th>
                <th>角色</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.displayName}</td>
                  <td>{user.authProvider}</td>
                  <td>{user.roles.join(", ") || "—"}</td>
                  <td>{user.isActive ? "啟用" : "停用"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {users.length === 0 && <div className="empty-state">目前沒有使用者。</div>}
        </section>
      )}
    </main>
  );
}
