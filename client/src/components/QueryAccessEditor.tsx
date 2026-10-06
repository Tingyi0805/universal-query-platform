import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./QueryAccessEditor.css";

type Role = { id: number; code: string; name: string; isActive: boolean };
type User = { id: number; username: string; displayName: string; isActive: boolean };
type RoleAccess = { roleId: number; canView: boolean; canExecute: boolean; canExport: boolean };
type UserAccess = {
  userId: number;
  username: string;
  displayName: string;
  isActive: boolean;
  canView: boolean;
  canExecute: boolean;
  canExport: boolean;
};

export function QueryAccessEditor({ queryId }: { queryId: number }) {
  const { accessToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleAccess, setRoleAccess] = useState<RoleAccess[]>([]);
  const [userAccess, setUserAccess] = useState<UserAccess[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<User[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{
        roles: Role[];
        roleAccess: RoleAccess[];
        userAccess: UserAccess[];
      }>(`/query-definitions/${queryId}/access`, {}, accessToken);
      setRoles(result.roles);
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

  function patchRole(roleId: number, patch: Partial<RoleAccess>) {
    setRoleAccess((rows) => rows.map((row) => row.roleId === roleId ? { ...row, ...patch } : row));
  }

  function patchUser(userId: number, patch: Partial<UserAccess>) {
    setUserAccess((rows) => rows.map((row) => row.userId === userId ? { ...row, ...patch } : row));
  }

  async function searchUsers(event?: FormEvent) {
    event?.preventDefault();
    const q = userSearch.trim();
    if (!q) {
      setUserResults([]);
      return;
    }

    setSearchingUsers(true);
    setError("");
    try {
      const result = await apiRequest<{ users: User[] }>(
        `/query-definitions/${queryId}/access/users?q=${encodeURIComponent(q)}&limit=20`,
        {},
        accessToken,
      );
      setUserResults(result.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜尋使用者失敗。");
    } finally {
      setSearchingUsers(false);
    }
  }

  function addUser(user: User) {
    setUserAccess((rows) => {
      if (rows.some((row) => row.userId === user.id)) return rows;
      return [...rows, {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        isActive: user.isActive,
        canView: true,
        canExecute: true,
        canExport: false,
      }];
    });
  }

  function removeUser(userId: number) {
    setUserAccess((rows) => rows.filter((row) => row.userId !== userId));
  }

  async function save() {
    setError("");
    setNotice("");
    try {
      await apiRequest(`/query-definitions/${queryId}/access`, {
        method: "PUT",
        body: JSON.stringify({
          roles: roleAccess,
          users: userAccess.map(({ userId, canView, canExecute, canExport }) => ({
            userId,
            canView,
            canExecute,
            canExport,
          })),
        }),
      }, accessToken);
      setNotice("Query 權限已儲存。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Query 權限失敗。");
    }
  }

  if (loading) {
    return <section className="query-access-panel"><div className="notice">權限載入中…</div></section>;
  }

  return (
    <section className="query-access-panel">
      <div className="section-title">
        <div>
          <h2>Query 使用權限</h2>
          <p>建議以角色授權為主；個別使用者只用於例外或額外授權。</p>
        </div>
        <button className="primary-button" type="button" onClick={() => void save()}>儲存權限</button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="access-columns">
        <div>
          <div className="access-heading">
            <h3>角色授權</h3>
            <span>主要授權方式</span>
          </div>
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
                      <label><input type="checkbox" checked={access.canView} onChange={(e) => patchRole(role.id, { canView: e.target.checked })} />檢視</label>
                      <label><input type="checkbox" checked={access.canExecute} onChange={(e) => patchRole(role.id, { canExecute: e.target.checked })} />執行</label>
                      <label><input type="checkbox" checked={access.canExport} onChange={(e) => patchRole(role.id, { canExport: e.target.checked })} />匯出</label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        <div>
          <div className="access-heading">
            <h3>個別使用者</h3>
            <span>例外授權</span>
          </div>

          <form className="user-access-search" onSubmit={(event) => void searchUsers(event)}>
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="輸入帳號或姓名"
              aria-label="搜尋使用者"
            />
            <button className="secondary-button" type="submit" disabled={searchingUsers}>
              {searchingUsers ? "搜尋中…" : "搜尋"}
            </button>
          </form>

          {userResults.length > 0 && (
            <div className="user-search-results">
              {userResults.map((user) => {
                const added = userAccess.some((row) => row.userId === user.id);
                return (
                  <div className="user-search-result" key={user.id}>
                    <span>{user.displayName}<small>{user.username}</small></span>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={added}
                      onClick={() => addUser(user)}
                    >
                      {added ? "已加入" : "加入"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="selected-user-access">
            <h4>已授權使用者</h4>
            {userAccess.length === 0 ? (
              <div className="empty-access">目前沒有個別使用者授權。</div>
            ) : (
              userAccess.map((access) => (
                <article className="access-row selected-user-row" key={access.userId}>
                  <div className="selected-user-title">
                    <span>{access.displayName}<small>{access.username}</small></span>
                    <button className="remove-access-button" type="button" onClick={() => removeUser(access.userId)}>移除</button>
                  </div>
                  <div className="access-flags">
                    <label><input type="checkbox" checked={access.canView} onChange={(e) => patchUser(access.userId, { canView: e.target.checked })} />檢視</label>
                    <label><input type="checkbox" checked={access.canExecute} onChange={(e) => patchUser(access.userId, { canExecute: e.target.checked })} />執行</label>
                    <label><input type="checkbox" checked={access.canExport} onChange={(e) => patchUser(access.userId, { canExport: e.target.checked })} />匯出</label>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
