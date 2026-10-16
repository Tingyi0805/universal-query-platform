import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { normalizeIds } from "../security/ids";
type Audience = {
  id: number;
  kind: "DEPARTMENT" | "GROUP";
  code: string;
  displayName: string;
  isActive: boolean;
  revision: number;
};
export function WorkstationAudienceManager({
  onChanged,
}: {
  onChanged: () => void;
}) {
  const sequence = useRef(0);
  const { accessToken } = useAuth();
  const [items, setItems] = useState<Audience[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState({
    id: null as number | null,
    kind: "DEPARTMENT" as "DEPARTMENT" | "GROUP",
    code: "",
    displayName: "",
    isActive: true,
    expectedRevision: 1,
  });
  const [ids, setIds] = useState<number[]>([]);
  const [staff, setStaff] = useState<{ id: number; displayName: string }[]>([]);
  const [staffSearch, setStaffSearch] = useState("");
  const [staffPage, setStaffPage] = useState(1);
  const [staffTotal, setStaffTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const r = await apiRequest<{ audiences: Audience[]; total: number }>(
      `/admin/workstation-audiences?page=${page}&pageSize=20&search=${encodeURIComponent(search)}`,
      {},
      accessToken,
    );
    setItems(r.audiences);
    setTotal(r.total);
  }, [accessToken, page, search]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    let live = true;
    void apiRequest<{
      users: { id: number; displayName: string }[];
      total: number;
    }>(
      `/admin/users?status=ACTIVE&page=${staffPage}&pageSize=20&search=${encodeURIComponent(staffSearch)}`,
      {},
      accessToken,
    )
      .then((r) => {
        if (live) {
          setStaff(
            r.users.map((u) => ({ ...u, id: normalizeIds([u.id])[0]! })),
          );
          setStaffTotal(r.total);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [accessToken, staffPage, staffSearch]);
  async function select(a: Audience) {
    const current = ++sequence.current;
    setLoaded(false);
    setError("");
    setForm({
      id: a.id,
      kind: a.kind,
      code: a.code,
      displayName: a.displayName,
      isActive: a.isActive,
      expectedRevision: a.revision,
    });
    try {
      const r = await apiRequest<{
        userIds: number[];
        expectedRevision: number;
      }>(`/admin/workstation-audiences/${a.id}/members`, {}, accessToken);
      if (current !== sequence.current) return;
      setIds(normalizeIds(r.userIds));
      setForm((f) => ({ ...f, expectedRevision: r.expectedRevision }));
      setLoaded(true);
    } catch (e) {
      if (current === sequence.current)
        setError(e instanceof Error ? e.message : "讀取失敗。");
    }
  }
  async function save() {
    if (
      !loaded ||
      !window.confirm(
        "成員異動會更新所有相關工作站允許名單並撤銷憑證與 Session，確定儲存？",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { id, ...data } = form;
      await apiRequest(
        `/admin/workstation-audiences${id === null ? "" : `/${id}`}`,
        {
          method: id === null ? "POST" : "PUT",
          body: JSON.stringify({ ...data, userIds: normalizeIds(ids) }),
        },
        accessToken,
      );
      setNotice("部門／群組與成員已儲存；相關工作站須重新核發憑證。");
      setForm({
        id: null,
        kind: "DEPARTMENT",
        code: "",
        displayName: "",
        isActive: true,
        expectedRevision: 1,
      });
      setIds([]);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-section">
      <h2>部門與自訂群組成員</h2>
      <p>此分類只管理工作站允許名單，不會指派角色或新增 API 權限。</p>
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <label>
        搜尋組織分類
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <div className="touch-actions">
        {items.map((a) => (
          <button disabled={busy} key={a.id} onClick={() => void select(a)}>
            {a.kind === "DEPARTMENT" ? "部門" : "群組"}：{a.displayName}
          </button>
        ))}
      </div>
      <div className="touch-actions">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          組織上一頁
        </button>
        <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
          組織下一頁
        </button>
        <button
          onClick={() => {
            sequence.current++;
            setForm({
              id: null,
              kind: "DEPARTMENT",
              code: "",
              displayName: "",
              isActive: true,
              expectedRevision: 1,
            });
            setIds([]);
            setLoaded(true);
          }}
        >
          新增分類
        </button>
      </div>
      <div className="admin-form">
        <label>
          分類類型
          <select
            disabled={form.id !== null}
            value={form.kind}
            onChange={(e) =>
              setForm({ ...form, kind: e.target.value as typeof form.kind })
            }
          >
            <option value="DEPARTMENT">部門</option>
            <option value="GROUP">自訂群組</option>
          </select>
        </label>
        <label>
          分類代碼
          <input
            disabled={form.id !== null}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </label>
        <label>
          分類名稱
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          啟用分類
        </label>
        <label>
          搜尋分類成員
          <input
            value={staffSearch}
            onChange={(e) => {
              setStaffSearch(e.target.value);
              setStaffPage(1);
            }}
          />
        </label>
        {!loaded ? (
          <p>成員載入失敗或讀取中，暫不可儲存。</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                setIds((current) =>
                  normalizeIds([...current, ...staff.map((u) => u.id)]),
                )
              }
            >
              批次選取本頁成員
            </button>
            <div className="check-grid">
              {staff.map((u) => (
                <label key={u.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(u.id)}
                    onChange={(e) =>
                      setIds((current) =>
                        e.target.checked
                          ? normalizeIds([...current, u.id])
                          : current.filter((id) => id !== u.id),
                      )
                    }
                  />
                  {u.displayName}
                </label>
              ))}
            </div>
          </>
        )}
        <div className="touch-actions">
          <button
            disabled={staffPage === 1}
            onClick={() => setStaffPage(staffPage - 1)}
          >
            成員上一頁
          </button>
          <span>已選 {ids.length} 人</span>
          <button
            disabled={staffPage * 20 >= staffTotal}
            onClick={() => setStaffPage(staffPage + 1)}
          >
            成員下一頁
          </button>
        </div>
        <button
          className="primary-button"
          disabled={busy || !loaded || !form.code || !form.displayName}
          onClick={() => void save()}
        >
          儲存分類與成員
        </button>
      </div>
    </section>
  );
}
