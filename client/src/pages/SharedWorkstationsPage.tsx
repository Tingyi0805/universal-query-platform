import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AdminUsersPage.css";

type Workstation = { id: number; workstationCode: string; displayName: string; isActive: boolean; pinLoginEnabled: boolean };
export function SharedWorkstationsPage() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<Workstation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [staff, setStaff] = useState<{ id: number; username: string; displayName: string; isActive: boolean }[]>([]);
  const [allowedIds, setAllowedIds] = useState<number[]>([]);
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const data = await apiRequest<{ workstations: Workstation[] }>("/admin/shared-workstations", {}, accessToken); setItems(data.workstations); }
    catch (e) { setError(e instanceof Error ? e.message : "載入失敗"); }
  }, [accessToken]);
  useEffect(() => { void load(); }, [load]);
  async function selectWorkstation(id: number) {
    setError(""); setSelectedId(id);
    try {
      const [users, assigned] = await Promise.all([
        apiRequest<{ users: { id: number; username: string; displayName: string; isActive: boolean }[] }>("/admin/users", {}, accessToken),
        apiRequest<{ users: { userId: number }[] }>(`/admin/shared-workstations/${id}/users`, {}, accessToken),
      ]);
      setStaff(users.users.filter(u => u.isActive));
      setAllowedIds(assigned.users.map(u => u.userId));
    } catch (e) { setError(e instanceof Error ? e.message : "載入允許使用者失敗"); }
  }
  async function saveAllowed() {
    if (selectedId === null || !window.confirm("更新員工清單將撤銷此工作站的所有 Session。確定儲存？")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/admin/shared-workstations/${selectedId}/users`, {
        method: "PUT", body: JSON.stringify({ userIds: allowedIds }),
      }, accessToken);
      setNotice("允許使用的員工已更新；PIN 登入仍未啟用。");
    } catch (e) { setError(e instanceof Error ? e.message : "儲存失敗"); }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/admin/shared-workstations", { method: "POST", body: JSON.stringify({ workstationCode: code, displayName: name }) }, accessToken);
      setCode(""); setName(""); setNotice("工作站已建立，PIN 登入仍維持停用。"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "新增失敗"); }
    finally { setBusy(false); }
  }
  async function toggle(item: Workstation) {
    if (!window.confirm(`確定${item.isActive ? "停用" : "啟用"}「${item.displayName}」？此操作會撤銷現有工作站 Session。`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(`/admin/shared-workstations/${item.id}`, { method: "PUT", body: JSON.stringify({ displayName: item.displayName, isActive: !item.isActive }) }, accessToken);
      setNotice("工作站狀態已更新；PIN 登入仍未啟用。"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "更新失敗"); }
    finally { setBusy(false); }
  }
  return <main className="page-shell">
    <div className="page-toolbar"><div><p className="eyebrow">Security</p><h1>共用工作站管理</h1><p className="subtitle">登記護理站共用裝置，預設不開放 PIN 登入。</p></div>
      <Link className="secondary-button link-button" to="/">返回首頁</Link></div>
    {error && <section className="form-error" role="alert">{error}</section>}
    {notice && <section className="notice" role="status">{notice}</section>}
    <section className="admin-section"><h2>新增工作站</h2>
      <form className="admin-form" onSubmit={create}>
        <label>工作站代碼<input value={code} onChange={e => setCode(e.target.value)} placeholder="NURSE-STATION-01" required /></label>
        <label>工作站名稱<input value={name} onChange={e => setName(e.target.value)} placeholder="一樓護理站平板" required /></label>
        <button className="primary-button" type="submit" disabled={busy}>新增工作站</button>
      </form></section>
    <section className="admin-section"><h2>已登記工作站</h2>
      {items.length === 0 ? <p>尚無工作站。</p> : <div className="admin-form">
        {items.map(item => <div key={item.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 12, borderBottom: "1px solid #ddd" }}>
          <strong>{item.displayName}</strong><span>{item.workstationCode}</span>
          <span>{item.isActive ? "已啟用（僅登記）" : "停用"}</span><span>PIN 登入：停用</span>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void selectWorkstation(item.id)}>設定允許員工</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => toggle(item)}>
            {item.isActive ? "停用工作站" : "啟用工作站登記"}
          </button>
        </div>)}
      </div>}
    </section>
    {selectedId !== null && <section className="admin-section">
      <h2>允許使用的員工（工作站 #{selectedId}）</h2>
      <p>僅設定允許名單，不會啟用 PIN 登入。</p>
      <div className="admin-form">
        {staff.map(u => <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input type="checkbox" checked={allowedIds.includes(u.id)}
            onChange={e => setAllowedIds(current => e.target.checked ? [...current, u.id] : current.filter(id => id !== u.id))} />
          {u.displayName}（{u.username}）
        </label>)}
        <button type="button" className="primary-button" disabled={busy} onClick={() => void saveAllowed()}>儲存允許員工</button>
      </div>
    </section>}
  </main>;
}
