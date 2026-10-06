import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./QueryAccessEditor.css";

type Role = { id: number; code: string; name: string; isActive: boolean };
type User = { id: number; username: string; displayName: string; isActive: boolean };
type RoleAccess = { roleId: number; canView: boolean; canExecute: boolean; canExport: boolean };
type UserAccess = { userId: number; canView: boolean; canExecute: boolean; canExport: boolean };

export function QueryAccessEditor({ queryId }: { queryId: number }) {
  const { accessToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [roleAccess, setRoleAccess] = useState<RoleAccess[]>([]);
  const [userAccess, setUserAccess] = useState<UserAccess[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{
        roles: Role[];
        users: User[];
        roleAccess: RoleAccess[];
        userAccess: UserAccess[];
      }>(`/query-definitions/${queryId}/access`, {}, accessToken);
      setRoles(result.roles);
      setUsers(result.users);
      setRoleAccess(result.roleAccess);
      setUserAccess(result.userAccess);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Query 權限失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, queryId]);

  useEffect(() => { void load(); }, [load]);

  function toggleRole(roleId: number) {
    setRoleAccess((rows) => {
      const existing = rows.find((row) => row.roleId === roleId);
      return existing
        ? rows.filter((row) => row.roleId !== roleId)
        : [...rows, { roleId, canView: true, canExecute: true, canExport: false }];
    });
  }

  function toggleUser(userId: number) {
    setUserAccess((rows) => {
      const existing = rows.find((row) => row.userId === userId);
      return existing
        ? rows.filter((row) => row.userId !== userId)
        : [...rows, { userId, canView: true, canExecute: true, canExport: false }];
    });
  }

  function patchRole(roleId: number, patch: Partial<RoleAccess>) {
    setRoleAccess((rows) => rows.map((row) => row.roleId === roleId ? { ...row, ...patch } : row));
  }

  function patchUser(userId: number, patch: Partial<UserAccess>) {
    setUserAccess((rows) => rows.map((row) => row.userId === userId ? { ...row, ...patch } : row));
  }

  async function save() {
    setError("");
    setNotice("");
    try {
      await apiRequest(`/query-definitions/${queryId}/access`, {
        method: "PUT",
        body: JSON.stringify({ roles: roleAccess, users: userAccess }),
      }, accessToken);
      setNotice("Query 權限已儲存。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Query 權限失敗。");
    }
  }

  if (loading) return <section className="query-access-panel"><div className="notice">權限載入中…</div></section>;

  return (
    <section className="query-access-panel">
      <div className="section-title">
        <div>
          <h2>Query 使用權限</h2>
          <p>可透過角色授權，也可直接額外授權給個別使用者。</p>
        </div>
        <button className="primary-button" type="button" onClick={() => void save()}>儲存權限</button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="access-columns">
        <div>
          <h3>角色</h3>
          <div className="access-list">
            {roles.map((role) => {
              const access = roleAccess.find((row) => row.roleId === role.id);
              return (
                <article className="access-row" key={role.id}>
                  <label className="access-name">
                    <input type="checkbox" checked={Boolean(access)} onChange={() => toggleRole(role.id)} />
                    <span>{role.name}<small>{role.code}</small></span>
                  </label>
                  {access && (
                    <div className="access-flags">
                      <label><input type="checkbox" checked={access.canView} onChange={(e) => patchRole(role.id, { canView: e.target.checked })} />View</label>
                      <label><input type="checkbox" checked={access.canExecute} onChange={(e) => patchRole(role.id, { canExecute: e.target.checked })} />Execute</label>
                      <label><input type="checkbox" checked={access.canExport} onChange={(e) => patchRole(role.id, { canExport: e.target.checked })} />Export</label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        <div>
          <h3>個別使用者</h3>
          <div className="access-list">
            {users.map((user) => {
              const access = userAccess.find((row) => row.userId === user.id);
              return (
                <article className="access-row" key={user.id}>
                  <label className="access-name">
                    <input type="checkbox" checked={Boolean(access)} onChange={() => toggleUser(user.id)} />
                    <span>{user.displayName}<small>{user.username}</small></span>
                  </label>
                  {access && (
                    <div className="access-flags">
                      <label><input type="checkbox" checked={access.canView} onChange={(e) => patchUser(user.id, { canView: e.target.checked })} />View</label>
                      <label><input type="checkbox" checked={access.canExecute} onChange={(e) => patchUser(user.id, { canExecute: e.target.checked })} />Execute</label>
                      <label><input type="checkbox" checked={access.canExport} onChange={(e) => patchUser(user.id, { canExport: e.target.checked })} />Export</label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
