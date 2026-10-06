import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AdminUsersPage.css";

type UserRow = {
  id: number;
  username: string;
  displayName: string;
  authProvider: string;
  isActive: boolean;
  roles: string[];
};

type RoleRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  permissions: string[];
};

type PermissionRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
};

export function AdminUsersPage() {
  const { accessToken } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const [newUser, setNewUser] = useState({
    username: "",
    displayName: "",
    password: "",
    roleCodes: [] as string[],
  });

  const [newRole, setNewRole] = useState({
    code: "",
    name: "",
    description: "",
    permissionCodes: [] as string[],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [userResult, roleResult, permissionResult] = await Promise.all([
        apiRequest<{ users: UserRow[] }>("/admin/users", {}, accessToken),
        apiRequest<{ roles: RoleRow[] }>("/admin/roles", {}, accessToken),
        apiRequest<{ permissions: PermissionRow[] }>("/admin/permissions", {}, accessToken),
      ]);
      setUsers(userResult.users);
      setRoles(roleResult.roles);
      setPermissions(permissionResult.permissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  const activeRoles = useMemo(() => roles.filter((role) => role.isActive), [roles]);

  const toggleCode = (codes: string[], code: string) =>
    codes.includes(code) ? codes.filter((x) => x !== code) : [...codes, code];

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await apiRequest("/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      }, accessToken);
      setNewUser({ username: "", displayName: "", password: "", roleCodes: [] });
      setNotice("使用者已建立。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立使用者失敗。");
    }
  }

  async function saveUser(user: UserRow) {
    setError("");
    setNotice("");
    try {
      await apiRequest(`/admin/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName: user.displayName,
          isActive: user.isActive,
          roleCodes: user.roles,
        }),
      }, accessToken);
      setNotice(`${user.username} 已更新。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新使用者失敗。");
    }
  }

  async function resetPassword(user: UserRow) {
    const password = window.prompt(`請輸入 ${user.username} 的新密碼（至少 10 字元）`);
    if (!password) return;
    setError("");
    setNotice("");
    try {
      await apiRequest(`/admin/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }, accessToken);
      setNotice(`${user.username} 密碼已重設。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重設密碼失敗。");
    }
  }

  async function deleteUser(user: UserRow) {
    setError("");
    setNotice("");

    try {
      const impact = await apiRequest<{
        canDelete: boolean;
        auditLogCount: number;
        publishedQueryCount: number;
        userQueryAccessCount: number;
        userRoleCount: number;
      }>(`/admin/users/${user.id}/delete-impact`, {}, accessToken);

      if (!impact.canDelete) {
        setError(
          `使用者「${user.username}」已有歷史資料（稽核 ${impact.auditLogCount} 筆、發布查詢 ${impact.publishedQueryCount} 筆），為保留追溯紀錄不可永久刪除，請改為停用。`,
        );
        return;
      }

      if (!window.confirm(`確定永久刪除使用者「${user.username}」？此操作無法復原。`)) return;

      await apiRequest(`/admin/users/${user.id}`, { method: "DELETE" }, accessToken);
      setNotice(`${user.username} 已刪除。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除使用者失敗。");
    }
  }

  async function createRole(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await apiRequest("/admin/roles", {
        method: "POST",
        body: JSON.stringify({
          ...newRole,
          code: newRole.code.toUpperCase(),
          description: newRole.description || null,
        }),
      }, accessToken);
      setNewRole({ code: "", name: "", description: "", permissionCodes: [] });
      setNotice("角色已建立。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立角色失敗。");
    }
  }

  async function saveRole(role: RoleRow) {
    setError("");
    setNotice("");
    try {
      await apiRequest(`/admin/roles/${role.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: role.name,
          description: role.description,
          isActive: role.isActive,
          permissionCodes: role.permissions,
        }),
      }, accessToken);
      setNotice(`${role.code} 已更新。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新角色失敗。");
    }
  }

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
      {notice && <section className="notice">{notice}</section>}

      {!loading && (
        <>
          <section className="admin-section">
            <h2>新增使用者</h2>
            <form className="admin-form" onSubmit={createUser}>
              <input placeholder="帳號" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
              <input placeholder="顯示名稱" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
              <input type="password" placeholder="初始密碼（至少 10 字元）" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              <div className="check-grid">
                {activeRoles.map((role) => (
                  <label key={role.code}>
                    <input type="checkbox" checked={newUser.roleCodes.includes(role.code)}
                      onChange={() => setNewUser({ ...newUser, roleCodes: toggleCode(newUser.roleCodes, role.code) })} />
                    {role.name} ({role.code})
                  </label>
                ))}
              </div>
              <button className="primary-button" type="submit">建立使用者</button>
            </form>
          </section>

          <section className="admin-section">
            <h2>使用者</h2>
            <div className="table-card">
              <table>
                <thead>
                  <tr><th>帳號</th><th>顯示名稱</th><th>驗證</th><th>角色</th><th>啟用</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>
                        <input value={user.displayName}
                          onChange={(e) => setUsers((rows) => rows.map((x) => x.id === user.id ? { ...x, displayName: e.target.value } : x))} />
                      </td>
                      <td>{user.authProvider}</td>
                      <td>
                        <div className="check-grid compact">
                          {roles.map((role) => (
                            <label key={role.code}>
                              <input type="checkbox" checked={user.roles.includes(role.code)}
                                disabled={!role.isActive && !user.roles.includes(role.code)}
                                onChange={() => setUsers((rows) => rows.map((x) => x.id === user.id ? { ...x, roles: toggleCode(x.roles, role.code) } : x))} />
                              {role.code}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td>
                        <input type="checkbox" checked={user.isActive}
                          onChange={(e) => setUsers((rows) => rows.map((x) => x.id === user.id ? { ...x, isActive: e.target.checked } : x))} />
                      </td>
                      <td className="actions">
                        <button className="secondary-button" type="button" onClick={() => void saveUser(user)}>儲存</button>
                        {user.authProvider === "LOCAL" && (
                          <button className="secondary-button" type="button" onClick={() => void resetPassword(user)}>重設密碼</button>
                        )}
                        <button className="danger-button" type="button" onClick={() => void deleteUser(user)}>刪除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <div className="empty-state">目前沒有使用者。</div>}
            </div>
          </section>

          <section className="admin-section">
            <h2>新增角色</h2>
            <form className="admin-form" onSubmit={createRole}>
              <input placeholder="角色代碼，例如 FINANCE_VIEWER" value={newRole.code}
                onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toUpperCase() })} />
              <input placeholder="角色名稱" value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} />
              <input placeholder="說明" value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />
              <div className="check-grid">
                {permissions.map((permission) => (
                  <label key={permission.code} title={permission.description ?? ""}>
                    <input type="checkbox" checked={newRole.permissionCodes.includes(permission.code)}
                      onChange={() => setNewRole({ ...newRole, permissionCodes: toggleCode(newRole.permissionCodes, permission.code) })} />
                    {permission.name} ({permission.code})
                  </label>
                ))}
              </div>
              <button className="primary-button" type="submit">建立角色</button>
            </form>
          </section>

          <section className="admin-section">
            <h2>角色與權限</h2>
            <div className="role-grid">
              {roles.map((role) => (
                <article className="role-card" key={role.id}>
                  <div className="role-title">
                    <div>
                      <strong>{role.code}</strong>
                      {role.isSystem && <span className="badge">System</span>}
                    </div>
                    <label>
                      <input type="checkbox" checked={role.isActive}
                        disabled={role.code === "SYSTEM_ADMIN"}
                        onChange={(e) => setRoles((rows) => rows.map((x) => x.id === role.id ? { ...x, isActive: e.target.checked } : x))} />
                      啟用
                    </label>
                  </div>
                  <input value={role.name}
                    onChange={(e) => setRoles((rows) => rows.map((x) => x.id === role.id ? { ...x, name: e.target.value } : x))} />
                  <input value={role.description ?? ""} placeholder="角色說明"
                    onChange={(e) => setRoles((rows) => rows.map((x) => x.id === role.id ? { ...x, description: e.target.value } : x))} />
                  <div className="check-grid">
                    {permissions.map((permission) => (
                      <label key={permission.code}>
                        <input type="checkbox" checked={role.permissions.includes(permission.code)}
                          onChange={() => setRoles((rows) => rows.map((x) => x.id === role.id ? { ...x, permissions: toggleCode(x.permissions, permission.code) } : x))} />
                        {permission.code}
                      </label>
                    ))}
                  </div>
                  <button className="secondary-button" type="button" onClick={() => void saveRole(role)}>儲存角色</button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
