import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { normalizeIds } from "../security/ids";
import { WorkstationAudienceManager } from "../components/WorkstationAudienceManager";
import "./AdminUsersPage.css";
import "./WorkstationManagement.css";
type Workstation = {
  id: number;
  workstationCode: string;
  displayName: string;
  platformCode: string;
  purposeCode: "SHARED_QUERY" | "DASHBOARD";
  sortOrder: number;
  isActive: boolean;
  retiredAtUtc: string | null;
  credentialVersion: number;
};
type Staff = { id: number; displayName: string; username: string };
type Audience = {
  id: number;
  kind: "DEPARTMENT" | "GROUP";
  displayName: string;
  isActive: boolean;
};
type Grants = {
  workstation?: Workstation;
  userIds: number[];
  departmentIds: number[];
  groupIds: number[];
  expectedVersion: number;
};
const empty: Grants = {
  userIds: [],
  departmentIds: [],
  groupIds: [],
  expectedVersion: 1,
};
export function SharedWorkstationsPage() {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<Workstation[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [grants, setGrants] = useState(empty);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantReady, setGrantReady] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [audienceSearch, setAudienceSearch] = useState("");
  const [audiencePage, setAudiencePage] = useState(1);
  const [audienceTotal, setAudienceTotal] = useState(0);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<"SHARED_QUERY" | "DASHBOARD">(
    "SHARED_QUERY",
  );
  const [sort, setSort] = useState(0);
  const [createPurpose, setCreatePurpose] = useState<
    "SHARED_QUERY" | "DASHBOARD"
  >("SHARED_QUERY");
  const [createSort, setCreateSort] = useState(0);
  const [code, setCode] = useState("");
  const [newName, setNewName] = useState("");
  const [platform, setPlatform] = useState("UNKNOWN");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyId, setCopyId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<
    { id: number; deviceName: string; workstationId: number | null }[]
  >([]);
  const [effective, setEffective] = useState<
    {
      userId: number;
      displayName: string;
      username: string;
      permissions: string[];
      workstationEnabled: boolean;
    }[]
  >([]);
  const [effectiveSearch, setEffectiveSearch] = useState("");
  const [effectivePage, setEffectivePage] = useState(1);
  const [effectiveTotal, setEffectiveTotal] = useState(0);
  const selection = useRef(0);
  const item = items.find((w) => w.id === selected);
  const load = useCallback(async () => {
    const result = await apiRequest<{
      schemaReady: boolean;
      workstations: Workstation[];
    }>("/admin/workstation-management", {}, accessToken);
    setReady(result.schemaReady);
    setItems(
      result.workstations.map((w) => ({ ...w, id: normalizeIds([w.id])[0]! })),
    );
  }, [accessToken]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    let live = true;
    void apiRequest<{ users: Staff[]; total: number }>(
      `/admin/users?status=ACTIVE&page=${page}&pageSize=20&search=${encodeURIComponent(search)}`,
      {},
      accessToken,
    )
      .then((result) => {
        if (live) {
          setStaff(
            result.users.map((u) => ({ ...u, id: normalizeIds([u.id])[0]! })),
          );
          setTotal(result.total);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [accessToken, page, search]);
  const loadAudiences = useCallback(async () => {
    if (!ready) return;
    const result = await apiRequest<{ audiences: Audience[]; total: number }>(
      `/admin/workstation-audiences?page=${audiencePage}&pageSize=20&search=${encodeURIComponent(audienceSearch)}`,
      {},
      accessToken,
    );
    setAudiences(result.audiences);
    setAudienceTotal(result.total);
  }, [accessToken, ready, audiencePage, audienceSearch]);
  useEffect(() => {
    void loadAudiences().catch((e) => setError(e.message));
  }, [loadAudiences]);
  useEffect(() => {
    if (selected === null || !ready) return;
    let live = true;
    void apiRequest<{ users: typeof effective; total: number }>(
      `/admin/shared-workstations/${selected}/effective-users?page=${effectivePage}&pageSize=20&search=${encodeURIComponent(effectiveSearch)}`,
      {},
      accessToken,
    )
      .then((result) => {
        if (live) {
          setEffective(result.users);
          setEffectiveTotal(result.total);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected, ready, effectivePage, effectiveSearch, accessToken, items]);
  async function select(w: Workstation) {
    const sequence = ++selection.current;
    setSelected(w.id);
    setGrantLoading(true);
    setGrantReady(false);
    setGrants(empty);
    setError("");
    setNotice("");
    setEffective([]);
    setName(w.displayName);
    setPurpose(w.purposeCode);
    setSort(w.sortOrder);
    setCopyId("");
    setDeviceId("");
    setEffectivePage(1);
    try {
      const result = ready
        ? await apiRequest<Grants>(
            `/admin/shared-workstations/${w.id}/grants`,
            {},
            accessToken,
          )
        : {
            ...empty,
            userIds: (
              await apiRequest<{ users: { userId: number }[] }>(
                `/admin/shared-workstations/${w.id}/users`,
                {},
                accessToken,
              )
            ).users.map((u) => u.userId),
          };
      if (sequence !== selection.current) return;
      setGrantReady(true);
      if(result.workstation) {
        const current=result.workstation;
        setItems(rows=>rows.map(row=>row.id===current.id?current:row));
        setName(current.displayName);setPurpose(current.purposeCode);setSort(current.sortOrder);
      }
      setGrants({
        ...result,
        userIds: normalizeIds(result.userIds),
        departmentIds: normalizeIds(result.departmentIds),
        groupIds: normalizeIds(result.groupIds),
      });
      if (ready) {
        const response = await apiRequest<{ devices: typeof devices }>(
          "/admin/workstation-dashboard-devices",
          {},
          accessToken,
        );
        if (sequence === selection.current) setDevices(response.devices);
      }
    } catch (e) {
      if (sequence === selection.current)
        setError(e instanceof Error ? e.message : "授權讀取失敗。");
    } finally {
      if (sequence === selection.current) setGrantLoading(false);
    }
  }
  async function action(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(
        path,
        { method, body: JSON.stringify(body) },
        accessToken,
      );
      setNotice(success);
      await load();
      if (selected !== null && method !== "DELETE") {
        const data = await apiRequest<Grants>(
          `/admin/shared-workstations/${selected}/grants`,
          {},
          accessToken,
        );
        setGrants({
          ...data,
          userIds: normalizeIds(data.userIds),
          departmentIds: normalizeIds(data.departmentIds),
          groupIds: normalizeIds(data.groupIds),
        });
      }
      if (method === "DELETE") setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗。");
    } finally {
      setBusy(false);
    }
  }
  function toggle(
    key: "userIds" | "departmentIds" | "groupIds",
    id: number,
    checked: boolean,
  ) {
    setGrants((current) => ({
      ...current,
      [key]: checked
        ? normalizeIds([...current[key], id])
        : current[key].filter((value) => value !== id),
    }));
  }
  async function saveUsers() {
    if (
      !item ||
      !grantReady ||
      grantLoading ||
      !window.confirm(
        "儲存將撤銷此工作站的憑證與 Session，PIN 登入仍保持停用。確定繼續？",
      )
    )
      return;
    if (ready)
      await action(
        `/admin/shared-workstations/${item.id}/grants`,
        "PUT",
        {
          expectedVersion:grants.expectedVersion,
          userIds: normalizeIds(grants.userIds),
          departmentIds: normalizeIds(grants.departmentIds),
          groupIds: normalizeIds(grants.groupIds),
        },
        "授權已儲存；有效權限已重新計算。",
      );
    else {
      setBusy(true);
      try {
        await apiRequest(
          `/admin/shared-workstations/${item.id}/users`,
          {
            method: "PUT",
            body: JSON.stringify({ userIds: normalizeIds(grants.userIds) }),
          },
          accessToken,
        );
        setNotice("個別員工授權已更新；PIN 登入仍停用。");
      } catch (e) {
        setError(e instanceof Error ? e.message : "儲存失敗。");
      } finally {
        setBusy(false);
      }
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await action(
      "/admin/workstation-management",
      "POST",
      {
        workstationCode: code,
        displayName: newName,
        platformCode: platform,
        purposeCode: createPurpose,
        sortOrder: createSort,
      },
      "工作站已建立，預設停用。",
    );
  }
  return (
    <main className="page-shell workstation-management">
      <div className="page-toolbar">
        <div>
          <h1>工作站管理</h1>
          <p>授權名單不會增加員工的角色權限。工作站 PIN 登入仍未啟用。</p>
        </div>
        <Link to="/" className="secondary-button link-button">
          返回首頁
        </Link>
      </div>
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      {!ready && (
        <div className="notice">
          916 Schema
          尚未確認；目前可維護既有個別員工授權。新管理功能須先在隔離環境驗證，勿直接在共用資料庫執行
          Migration。
        </div>
      )}
      <section className="admin-section">
        <h2>新增工作站</h2>
        <form className="admin-form" onSubmit={create}>
          <label>
            工作站代碼
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <label>
            新增工作站名稱
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label>
            裝置平台
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {["UNKNOWN", "WINDOWS", "ANDROID", "IOS"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            新增工作站用途
            <select
              value={createPurpose}
              onChange={(e) =>
                setCreatePurpose(e.target.value as typeof createPurpose)
              }
            >
              <option value="SHARED_QUERY">共用查詢工作站</option>
              <option value="DASHBOARD">Dashboard 播放裝置</option>
            </select>
          </label>
          <label>
            新增工作站排序
            <input
              type="number"
              min={0}
              max={10000}
              value={createSort}
              onChange={(e) => setCreateSort(Number(e.target.value))}
            />
          </label>
          <button disabled={busy || !ready} className="primary-button">
            新增工作站
          </button>
        </form>
      </section>
      <section className="admin-section">
        <h2>已登記工作站</h2>
        <div className="workstation-list">
          {items.map((w) => (
            <button
              type="button"
              key={w.id}
              className="secondary-button"
              disabled={busy}
              onClick={() => void select(w)}
            >
              {w.displayName} ·{" "}
              {w.purposeCode === "DASHBOARD"
                ? "Dashboard 播放裝置"
                : "共用查詢工作站"}{" "}
              · {w.retiredAtUtc ? "已退役" : w.isActive ? "已啟用" : "停用"}
            </button>
          ))}
        </div>
      </section>
      {item && (
        <section className="admin-section">
          <h2>工作站 #{item.id}</h2>
          <label>
            工作站名稱
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            用途
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as typeof purpose)}
            >
              <option value="SHARED_QUERY">共用查詢工作站</option>
              <option value="DASHBOARD">Dashboard 播放裝置</option>
            </select>
          </label>
          <label>
            排序
            <input
              type="number"
              min={0}
              max={10000}
              value={sort}
              onChange={(e) => setSort(Number(e.target.value))}
            />
          </label>
          <div className="touch-actions">
            <button
              disabled={
                !grantReady || !ready || busy || Boolean(item.retiredAtUtc)
              }
              onClick={() =>
                void action(
                  `/admin/shared-workstations/${item.id}/management`,
                  "PUT",
                  {
                    displayName: name,
                    purposeCode: purpose,
                    sortOrder: sort,
                    isActive: item.isActive,
                    expectedVersion: grants.expectedVersion,
                  },
                  "工作站資料已更新。",
                )
              }
            >
              儲存工作站資料
            </button>
            <button
              disabled={
                !grantReady || !ready || busy || Boolean(item.retiredAtUtc)
              }
              onClick={() => {
                if (
                  window.confirm(
                    "狀態變更會撤銷舊憑證與 Session；重新啟用也須重新核發。是否繼續？",
                  )
                )
                  void action(
                    `/admin/shared-workstations/${item.id}/management`,
                    "PUT",
                    {
                      displayName: name,
                      purposeCode: purpose,
                      sortOrder: sort,
                      isActive: !item.isActive,
                      expectedVersion: grants.expectedVersion,
                    },
                    "工作站狀態已更新。",
                  );
              }}
            >
              {item.isActive ? "停用工作站" : "重新啟用工作站"}
            </button>
            <button
              disabled={
                !grantReady || !ready || busy || Boolean(item.retiredAtUtc)
              }
              onClick={() => {
                if (
                  window.confirm(
                    "安全退役不可重新啟用，將撤銷憑證、Session 與已綁定播放 Token。確定退役？",
                  )
                )
                  void action(
                    `/admin/shared-workstations/${item.id}/retire`,
                    "POST",
                    { expectedVersion: grants.expectedVersion },
                    "工作站已退役。",
                  );
              }}
            >
              安全退役
            </button>
            <button
              disabled={
                !grantReady ||
                !ready ||
                busy ||
                item.isActive ||
                Boolean(item.retiredAtUtc)
              }
              onClick={() => {
                if (
                  window.confirm(
                    "僅能刪除從未使用、無憑證／Session／播放綁定／揭露歷史的誤建工作站；稽核將保留。確定刪除？",
                  )
                )
                  void action(
                    `/admin/shared-workstations/${item.id}`,
                    "DELETE",
                    { expectedVersion: grants.expectedVersion },
                    "未使用工作站已刪除，稽核保留。",
                  );
              }}
            >
              刪除未使用工作站
            </button>
          </div>
          {grantLoading ? (
            <p>授權載入中…</p>
          ) : (
            <>
              <h3>個別員工授權</h3>
              <label>
                搜尋員工
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <div className="touch-actions">
                <button
                  onClick={() =>
                    setGrants((g) => ({
                      ...g,
                      userIds: normalizeIds([
                        ...g.userIds,
                        ...staff.map((u) => u.id),
                      ]),
                    }))
                  }
                >
                  選取本頁員工
                </button>
                <button
                  onClick={() =>
                    setGrants((g) => ({
                      ...g,
                      userIds: g.userIds.filter(
                        (id) => !staff.some((u) => u.id === id),
                      ),
                    }))
                  }
                >
                  取消本頁員工
                </button>
                <button
                  onClick={() => setGrants((g) => ({ ...g, userIds: [] }))}
                >
                  清除個別員工選取
                </button>
              </div>
              <div className="check-grid">
                {staff.map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={grants.userIds.includes(u.id)}
                      onChange={(e) =>
                        toggle("userIds", u.id, e.target.checked)
                      }
                    />
                    {u.displayName}（{u.username}）
                  </label>
                ))}
              </div>
              <div className="touch-actions">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  員工上一頁
                </button>
                <span>
                  {page} / {Math.max(1, Math.ceil(total / 20))}，已選{" "}
                  {grants.userIds.length}
                </span>
                <button
                  disabled={page * 20 >= total}
                  onClick={() => setPage(page + 1)}
                >
                  員工下一頁
                </button>
              </div>
              {ready && (
                <>
                  <h3>部門／自訂群組授權</h3>
                  <label>
                    搜尋部門或群組
                    <input
                      value={audienceSearch}
                      onChange={(e) => {
                        setAudienceSearch(e.target.value);
                        setAudiencePage(1);
                      }}
                    />
                  </label>
                  <div className="check-grid">
                    {audiences.map((a) => (
                      <label key={a.id}>
                        <input
                          type="checkbox"
                          disabled={
                            !a.isActive &&
                            !(
                              a.kind === "DEPARTMENT"
                                ? grants.departmentIds
                                : grants.groupIds
                            ).includes(a.id)
                          }
                          checked={(a.kind === "DEPARTMENT"
                            ? grants.departmentIds
                            : grants.groupIds
                          ).includes(a.id)}
                          onChange={(e) =>
                            toggle(
                              a.kind === "DEPARTMENT"
                                ? "departmentIds"
                                : "groupIds",
                              a.id,
                              e.target.checked,
                            )
                          }
                        />
                        {a.kind === "DEPARTMENT" ? "部門" : "群組"}：
                        {a.displayName}
                        {!a.isActive && "（停用）"}
                      </label>
                    ))}
                  </div>
                  <div className="touch-actions">
                    <button
                      disabled={audiencePage === 1}
                      onClick={() => setAudiencePage(audiencePage - 1)}
                    >
                      群組上一頁
                    </button>
                    <button
                      disabled={audiencePage * 20 >= audienceTotal}
                      onClick={() => setAudiencePage(audiencePage + 1)}
                    >
                      群組下一頁
                    </button>
                  </div>
                  <label>
                    複製其他工作站授權
                    <select
                      value={copyId}
                      onChange={(e) => setCopyId(e.target.value)}
                    >
                      <option value="">選擇來源</option>
                      {items
                        .filter((w) => w.id !== selected && !w.retiredAtUtc)
                        .map((w) => (
                          <option value={w.id} key={w.id}>
                            {w.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={!grantReady || busy || !copyId || Boolean(item.retiredAtUtc)}
                    onClick={() => {
                      if (
                        window.confirm(
                          "複製會取代此工作站授權並撤銷現有憑證與 Session。確定繼續？",
                        )
                      )
                        void action(
                          `/admin/shared-workstations/${item.id}/grants/copy`,
                          "POST",
                          {
                            sourceId: normalizeIds([copyId])[0],
                            expectedVersion: grants.expectedVersion,
                          },
                          "授權已複製。",
                        );
                    }}
                  >
                    複製授權
                  </button>
                </>
              )}
              <button
                className="primary-button"
                disabled={!grantReady || busy || Boolean(item.retiredAtUtc)}
                onClick={() => void saveUsers()}
              >
                儲存授權
              </button>
            </>
          )}
          {ready && (
            <>
              <h3>有效權限預覽（已儲存設定）</h3>
              <p>
                部門、群組與個人授權取聯集，只包含啟用員工；實際 API 仍檢查既有
                RBAC。PIN 登入未啟用。
              </p>
              <label>
                搜尋有效授權
                <input
                  value={effectiveSearch}
                  onChange={(e) => {
                    setEffectiveSearch(e.target.value);
                    setEffectivePage(1);
                  }}
                />
              </label>
              {effective.map((u) => (
                <p key={u.userId}>
                  {u.displayName}（{u.username}）·{" "}
                  {u.workstationEnabled ? "工作站已啟用" : "工作站停用／退役"} ·
                  角色權限：{u.permissions.join(", ") || "無"}
                </p>
              ))}
              <div className="touch-actions">
                <button
                  disabled={effectivePage === 1}
                  onClick={() => setEffectivePage(effectivePage - 1)}
                >
                  預覽上一頁
                </button>
                <span>共 {effectiveTotal} 人</span>
                <button
                  disabled={effectivePage * 20 >= effectiveTotal}
                  onClick={() => setEffectivePage(effectivePage + 1)}
                >
                  預覽下一頁
                </button>
              </div>
            </>
          )}
          {ready && item.purposeCode === "DASHBOARD" && (
            <>
              <h3>綁定 Dashboard 播放裝置</h3>
              <label>
                播放裝置
                <select
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                >
                  <option value="">選擇裝置</option>
                  {devices
                    .filter(
                      (d) =>
                        d.workstationId === null || d.workstationId === item.id,
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.deviceName}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={!grantReady || busy || !deviceId || Boolean(item.retiredAtUtc)}
                onClick={() => {
                  if (
                    window.confirm(
                      "綁定會停用並撤銷原播放 Token。請在 Dashboard 管理重新啟用及核發，是否繼續？",
                    )
                  )
                    void action(
                      `/admin/shared-workstations/${item.id}/dashboard-device`,
                      "POST",
                      {
                        deviceId: normalizeIds([deviceId])[0],
                        expectedVersion: grants.expectedVersion,
                      },
                      "播放裝置已綁定，原 Token 已撤銷。",
                    );
                }}
              >
                綁定並撤銷舊 Token
              </button>
            </>
          )}
        </section>
      )}
      {ready && (
        <WorkstationAudienceManager
          onChanged={() => {
            void loadAudiences();
            void load();
          }}
        />
      )}
    </main>
  );
}
