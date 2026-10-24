import { columnApprovals, type ColumnApprovals } from "../security/securityContracts";
import { managementError, trustedConfiguration, type QuerySourceConfiguration } from "../dashboard/querySourceManagement";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { datasetApprovalAllowed, inheritedMaskSample, maskAtLeastAsStrong } from "../dashboard/dataSettings";

type Rule = { columnName: string; sensitivityType: string; deviceMaskMode: string; customMask?: { prefix: number; suffix: number; symbol: string; start?: number; end?: number } | null };
const modes = ["OMIT", "INHERIT"];
const modeNames: Record<string, string> = { NONE: "原樣顯示（非敏感欄位）", NAME: "姓名部分遮蔽", MRN: "病歷號部分遮蔽", PHONE: "電話部分遮蔽", GENERIC: "一般部分遮蔽", FULL: "全部遮蔽", OMIT: "不傳送", CUSTOM: "沿用 Dataset CUSTOM（既有設定）", INHERIT: "沿用 Dataset 遮蔽規則" };
export function DashboardDataSettingsEditor({ dashboardId, accessToken }: { dashboardId: number; accessToken: string | null }) {
  const scope = useRef(0), readSequence = useRef(0);
  const [sourceKey, setSourceKey] = useState("PRIMARY");
  const [managed, setManaged] = useState<QuerySourceConfiguration | null>(null);
  const [saving, setSaving] = useState(false);
  const [approvals, setApprovals] = useState<ColumnApprovals | null>(null);
  const [approvalReady, setApprovalReady] = useState(false);
  const [policyRevision, setPolicyRevision] = useState(0);
  const [policy, setPolicy] = useState<Rule[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [column, setColumn] = useState("");
  const [mode, setMode] = useState("OMIT");
  async function reloadApprovals() {
    const read = ++readSequence.current;
    setApprovalReady(false); setLoaded(false); setSaving(true); setColumn(""); setMode("OMIT");
    try {
      // Read the write version BEFORE the masks, so concurrent updates can never
      // pair stale masks with a newer version. The server rejects intervening changes.
      const configuration = trustedConfiguration(await apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`, {}, accessToken));
      const value = columnApprovals(await apiRequest(`/dashboards/${dashboardId}/column-approvals`, {}, accessToken));
      if (value.dashboardId !== dashboardId) throw new Error("RESPONSE_INVALID");
      if (read !== readSequence.current) return;
      setManaged(configuration); setApprovals(value); setApprovalReady(true); setPolicyRevision(previous => previous + 1);
      setMessage("已載入最新核准版本，請重新選擇欄位並確認修改。");
    } catch (error) { if (read === readSequence.current) setMessage(managementError(error)); }
    finally { if (read === readSequence.current) setSaving(false); }
  }
  useEffect(() => {
    setManaged(null); setApprovals(null); setSourceKey("PRIMARY"); void reloadApprovals();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.dashboardId === dashboardId && detail.origin !== "approvals") void reloadApprovals();
    };
    window.addEventListener("uqp.dashboard.configuration.changed", changed);
    return () => { ++readSequence.current; ++scope.current; window.removeEventListener("uqp.dashboard.configuration.changed", changed); };
  }, [dashboardId, accessToken]);
  const selected = sourceKey === "PRIMARY" ? managed?.primary : managed?.sources.find(s => s.sourceKey === sourceKey);
  const selectedQueryId = selected?.queryDefinitionId;
  useEffect(() => {
    ++scope.current;
    const policyRead = readSequence.current;
    let active = true;
    setLoaded(false); setPolicy([]); setColumns([]); setColumn(""); setMode("OMIT");
    if (!selectedQueryId) return () => { active = false; ++scope.current; };
    void (async () => {
      const q = await apiRequest<{ queryDefinition: { datasetId: number } }>(`/query-definitions/${selectedQueryId}`, {}, accessToken);
      if (!Number.isSafeInteger(q.queryDefinition?.datasetId) || q.queryDefinition.datasetId < 1) throw new Error("QUERY_METADATA_UNAVAILABLE");
      const [s, c] = await Promise.all([
        apiRequest<{ columns: Rule[]; version: number }>(`/datasets/${q.queryDefinition.datasetId}/sensitive-columns`, {}, accessToken),
        apiRequest<{ columns: Array<{ columnName: string }> }>(`/query-definitions/${selectedQueryId}/report-columns`, {}, accessToken),
      ]);
      if (!Array.isArray(s.columns) || !Number.isSafeInteger(s.version) || s.version < 0 || (s.version === 0 && s.columns.length === 0)) throw new Error("POLICY_UNAVAILABLE");
      if (!active || policyRead !== readSequence.current) return;
      setPolicy(s.columns); setColumns(c.columns.map(c => c.columnName)); setLoaded(true);
    })().catch(() => { if (active && policyRead === readSequence.current) setMessage("無法確認 Query 或 Dataset 保護規則；已保留原設定，暫停欄位規則編輯。請重新載入。"); });
    return () => { active = false; ++scope.current; };
  }, [dashboardId, selectedQueryId, sourceKey, accessToken, managed?.version, policyRevision]);
  const masks = sourceKey === "PRIMARY" ? approvals?.deviceColumnMasks ?? {} : approvals?.deviceSourceColumnMasks[sourceKey] ?? {};
  const types = sourceKey === "PRIMARY" ? approvals?.deviceColumnTypes ?? {} : {};
  const matching = policy.filter(rule => rule.columnName.toUpperCase() === column.toUpperCase());
  const existing = Object.entries(masks).filter(([key]) => key.toUpperCase() === column.toUpperCase());
  const classified = Object.entries(types).some(([key, type]) => key.toUpperCase() === column.toUpperCase() && type !== "OTHER");
  const editable = !!managed?.editable && approvalReady && !!selectedQueryId && !saving;
  const allowed = (candidate: string) => loaded && editable && matching.length === 1 && existing.length <= 1
    && (existing[0]?.[1] === undefined || Object.prototype.hasOwnProperty.call(modeNames, existing[0]![1]))
    && (!classified || (candidate !== "NONE" && !(candidate === "INHERIT" && matching[0]?.deviceMaskMode === "NONE"))) && datasetApprovalAllowed(candidate, matching[0]);
  async function write(next: Record<string, string>, success: string) {
    if (!editable || !managed) return;
    const sequence = scope.current; setSaving(true);
    try {
      const result = await apiRequest<{ version: string }>(`/dashboards/${dashboardId}/query-sources/v1/disclosure`, { method: "PATCH", body: JSON.stringify({ expectedVersion: managed.version, sourceKey, masks: next }) }, accessToken);
      if (sequence !== scope.current) return;
      if (!/^[a-f0-9]{64}$/.test(result.version)) throw new Error("RESPONSE_INVALID");
      setApprovals(previous => previous ? { ...previous, ...(sourceKey === "PRIMARY" ? { deviceColumnMasks: next } : { deviceSourceColumnMasks: { ...previous.deviceSourceColumnMasks, [sourceKey]: next } }) } : null);
      setLoaded(false); setPolicyRevision(previous => previous + 1);
      setManaged(previous => previous ? { ...previous, version: result.version } : null);
      setMessage(success);
      window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "approvals" } }));
    } catch (error) { if (sequence === scope.current) { setApprovalReady(false); setMessage(managementError(error)); } }
    finally { if (sequence === scope.current) setSaving(false); }
  }
  async function addRule() {
    if (!column || !allowed(mode)) return;
    const current = existing[0]?.[1];
    if (current !== undefined && !maskAtLeastAsStrong(mode, current) && !(mode === "INHERIT" && current === matching[0]?.deviceMaskMode)
      && !window.confirm("這會變更 Dashboard 已保存的額外保護。Dataset 最低政策仍由後端強制執行，確定由管理者明確變更？")) return;
    await write({ ...masks, [existing[0]?.[0] ?? column]: mode }, "本來源欄位核准已安全儲存；Dataset 遮蔽由後端執行。");
  }
  // An explicit disclosure allowlist is still required for public displays.
  // Batch grants may only INHERIT a unique, configured Dataset policy;
  // they never create independent masking rules or include OMIT columns.
  const inheritable = columns.filter(name => {
    const matches = policy.filter(rule => rule.columnName.toUpperCase() === name.toUpperCase());
    return matches.length === 1 && matches[0]!.deviceMaskMode !== "OMIT"
      && (matches[0]!.sensitivityType === "OTHER" || matches[0]!.deviceMaskMode !== "NONE")
      && Object.keys(masks).filter(key => key.toUpperCase() === name.toUpperCase()).length <= 1;
  });
  async function approveInheritedColumns() {
    if (!editable || !loaded || !inheritable.length) return;
    const candidates = inheritable.filter(name => !Object.entries(masks).some(
      ([key, value]) => key.toUpperCase() === name.toUpperCase() && value === "INHERIT"));
    if (!candidates.length) return;
    if (!window.confirm(`確認授權此 Dashboard 的 ${sourceKey} 來源傳送以下 ${candidates.length} 個欄位？\n${candidates.join("、")}\n只沿用 Dataset 已確認的遮蔽規則；不包含 OMIT 欄位、不修改 Dataset，可能顯示於公共螢幕。`)) return;
    const next = { ...masks };
    for (const name of candidates) {
      const old = Object.keys(next).find(key => key.toUpperCase() === name.toUpperCase());
      if (old) delete next[old];
      next[name] = "INHERIT";
    }
    await write(next, `已明確核准 ${candidates.length} 個欄位沿用 Dataset 遮蔽規則；仍須通過稽核及播放預檢。`);
  }
  async function removeRule(name: string) {
    if (!editable || !window.confirm(`移除來源 ${sourceKey} 的欄位「${name}」核准？此欄位將不再傳送；分類與 Dataset 最低政策保留。`)) return;
    const next = { ...masks }; delete next[name];
    await write(next, `來源 ${sourceKey}：已移除指定欄位核准，分類及其他來源保持不變。`);
  }
  return <div className="wide" id="column-approvals">
    <button type="button" disabled={saving} onClick={() => void reloadApprovals()}>重新載入核准版本</button>
    {managed && !managed.editable && <p role="alert">須先停用 Dashboard 才可修改。不會自動停用或重新啟用。</p>}
    {!selectedQueryId && <p role="status">來源尚未轉換，請先明確選擇 Query；轉換後敏感欄位需要重新核准。</p>}
    <label>遮蔽核准來源<select aria-label="遮蔽核准來源" value={sourceKey} onChange={e => { setLoaded(false); setSourceKey(e.target.value); }} disabled={saving}><option value="PRIMARY">PRIMARY 主來源</option>{managed?.sources.map(source => <option key={source.sourceKey} value={source.sourceKey}>{source.sourceKey}</option>)}</select></label>
    <h3>Dataset 最低保護規則（{sourceKey}）</h3>
    {!loaded && <p role="status">尚未確認 Dataset 保護；暫停欄位規則編輯。</p>}
    {policy.map(rule => <p key={rule.columnName}>{rule.columnName}：{modeNames[rule.deviceMaskMode] ?? "未知規則，禁止變更"}{rule.customMask ? `（${rule.customMask.start === undefined ? `前 ${rule.customMask.prefix}／後 ${rule.customMask.suffix}` : `位置 ${rule.customMask.start}～${rule.customMask.end}`}，符號 ${rule.customMask.symbol}）` : ""}</p>)}
    <h3>Dashboard 播放欄位授權（沿用 Dataset）</h3>
    <p>本區只管理裝置可接收的欄位，不另設遮蔽。核准後一律沿用 Dataset；未核准與 OMIT 欄位不傳送。舊版獨立遮蔽與 Dataset 不相容時停止傳送，需管理者明確改為沿用 Dataset。此處不修改 Dataset。</p>
    <button type="button" disabled={!editable || !loaded || !inheritable.some(name => !Object.entries(masks).some(([key, value]) => key.toUpperCase() === name.toUpperCase() && value === "INHERIT"))} onClick={() => void approveInheritedColumns()}>確認授權本來源可傳送欄位（全部沿用 Dataset）</button>
    <p>僅包含 Query 顯示欄位中已有唯一 Dataset 規則、且非 OMIT 的欄位；需管理者逐次確認。既有舊規則不會自動清除，欄位政策變更仍由後端重新驗證。</p>
    <label>核准欄位<select disabled={!loaded || !approvalReady || saving} value={column} onChange={e => { setColumn(e.target.value); setMode("OMIT"); }}><option value="">請選擇欄位</option>{[...new Set([...columns, ...policy.map(p => p.columnName), ...Object.keys(masks)])].map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <label>欄位傳送方式<select disabled={!loaded || !approvalReady || saving} value={mode} onChange={e => setMode(e.target.value)}>{modes.map(candidate => <option key={candidate} value={candidate} disabled={!allowed(candidate)}>{modeNames[candidate]}</option>)}</select></label>
    {column && matching.length === 0 && <p role="status">Dataset 尚未定義此欄位的政策；不可核准傳送，原 JSON 保留。</p>}
    <p role="status">合成資料預覽：{(mode === "INHERIT" || mode === "CUSTOM") ? inheritedMaskSample(matching[0]) : mode === "OMIT" ? "欄位不傳送" : mode === "FULL" ? "○○○○" : mode === "NONE" ? "合成非敏感文字" : ({ NAME: "測○料", MRN: "0000○○34", PHONE: "0912○○○678", GENERIC: "測○○料" } as Record<string, string>)[mode]}。Dataset 規則仍為最低要求。</p>
    <button type="button" disabled={!column || !allowed(mode)} onClick={() => void addRule()}>儲存此欄位傳送授權</button>
    <table><thead><tr><th>欄位</th><th>已儲存核准模式</th><th>Dataset 最低政策</th><th>操作</th></tr></thead><tbody>{Object.entries(masks).map(([name, value]) => <tr key={name}><td>{name}</td><td>{modeNames[String(value)] ?? "未知舊規則：保留，需管理者審查"}</td><td>{modeNames[policy.find(rule => rule.columnName.toUpperCase() === name.toUpperCase())?.deviceMaskMode ?? ""] ?? "尚未確認"}</td><td><button type="button" disabled={!editable} onClick={() => void removeRule(name)}>移除 {name} 核准</button></td></tr>)}</tbody></table>
    <details><summary>既有遮蔽 JSON（唯讀保留）</summary><pre>{JSON.stringify(masks, null, 2)}</pre>{sourceKey === "PRIMARY" && <pre>{JSON.stringify(types, null, 2)}</pre>}</details>
    {message && <p role="status">{message}</p>}
  </div>;
}
