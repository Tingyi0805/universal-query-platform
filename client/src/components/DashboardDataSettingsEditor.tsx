import { managementError, type QuerySourceConfiguration } from "../dashboard/querySourceManagement";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { datasetApprovalAllowed, inheritedMaskSample, maskAtLeastAsStrong, objectJson, queryParameterValues } from "../dashboard/dataSettings";

type Rule = { columnName: string; sensitivityType: string; deviceMaskMode: string; customMask?: { prefix: number; suffix: number; symbol: string } | null };
type Parameter = { name: string; label: string; dataType: string; isRequired: boolean; defaultValue: string | null };
const modes = ["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT", "INHERIT"];
const modeNames: Record<string, string> = { NONE: "原樣顯示（非敏感欄位）", NAME: "姓名部分遮蔽", MRN: "病歷號部分遮蔽", PHONE: "電話部分遮蔽", GENERIC: "一般部分遮蔽", FULL: "全部遮蔽", OMIT: "不傳送", CUSTOM: "沿用 Dataset CUSTOM（既有設定）", INHERIT: "沿用 Dataset 遮蔽規則" };
export function DashboardDataSettingsEditor({ dashboardId, queryId, accessToken, parametersJson, masksJson, typesJson, sourceMasksJson = "{}", onChange }: {
  dashboardId?: number | null; sourceMasksJson?: string; queryId: number; accessToken: string | null; parametersJson: string; masksJson: string; typesJson: string;
  onChange: (patch: { parametersJson?: string; deviceColumnMasksJson?: string; deviceColumnTypesJson?: string; deviceSourceColumnMasksJson?: string }) => void;
}) {
  const scope = useRef(0);
  const [sourceKey, setSourceKey] = useState("PRIMARY");
  const [sources, setSources] = useState<Array<{ sourceKey: string; datasetId?: number; queryDefinitionId?: number | null }>>([]);
  const [managed, setManaged] = useState<QuerySourceConfiguration | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true; setManaged(undefined); setSources([]); setSourceKey("PRIMARY");
    if (!dashboardId) { setManaged(null); return () => { alive = false; }; }
    void apiRequest<QuerySourceConfiguration>(`/dashboards/${dashboardId}/query-sources/v1/configuration`, {}, accessToken).then(value => {
      if (!Array.isArray(value.sources) || !value.primary || typeof value.version !== "string") throw new Error("CONFIGURATION_INVALID");
      if (alive) { setManaged(value); setSources(value.sources); }
    }).catch(async error => {
      if (!alive) return;
      if ((error as { code?: string }).code !== "QUERY_SOURCE_MANAGEMENT_DISABLED") { setMessage(managementError(error)); return; }
      setManaged(null);
      try { const value = await apiRequest<{ sources: Array<{ sourceKey: string; datasetId: number }> }>(`/dashboards/${dashboardId}/data-sources`, {}, accessToken);
        if (alive) setSources(Array.isArray(value.sources) ? value.sources : []);
      } catch { if (alive) setMessage("來源清單讀取失敗；原核准設定保留。"); }
    });
    return () => { alive = false; };
  }, [dashboardId, accessToken]);
  const selectedSource = sources.find(source => source.sourceKey === sourceKey);
  const selectedQueryId = sourceKey === "PRIMARY" ? managed?.primary.queryDefinitionId ?? queryId : selectedSource?.queryDefinitionId;
  const legacyDatasetId = sourceKey === "PRIMARY" ? undefined : selectedSource?.datasetId;
  const [policy, setPolicy] = useState<Rule[]>([]);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [column, setColumn] = useState("");
  const [mode, setMode] = useState("OMIT");
  useEffect(() => {
    scope.current++;
    setSaving(false);
    let active = true;
    setLoaded(false); setPolicy([]); setColumns([]); setParameters([]); setColumn(""); setMessage("");
    if (!selectedQueryId && !legacyDatasetId) return () => { active = false; scope.current++; };
    void (async () => {
      const q = legacyDatasetId ? { queryDefinition: { datasetId: legacyDatasetId } } : await apiRequest<{ queryDefinition: { datasetId: number } }>(`/query-definitions/${selectedQueryId}`, {}, accessToken);
      if (!Number.isSafeInteger(q.queryDefinition?.datasetId) || q.queryDefinition.datasetId < 1) throw new Error("QUERY_METADATA_UNAVAILABLE");
      const [p, s, c] = await Promise.all([
        apiRequest<{ parameters: Parameter[]; preview: { detected: string[] } }>(`/datasets/${q.queryDefinition.datasetId}/parameters`, {}, accessToken),
        apiRequest<{ columns: Rule[]; version: number }>(`/datasets/${q.queryDefinition.datasetId}/sensitive-columns`, {}, accessToken),
        selectedQueryId ? apiRequest<{ columns: Array<{ columnName: string }> }>(`/query-definitions/${selectedQueryId}/report-columns`, {}, accessToken) : Promise.resolve({ columns: [] }),
      ]);
      if (!Array.isArray(s.columns) || !Number.isSafeInteger(s.version) || s.version < 0 || (s.version === 0 && s.columns.length === 0) || !Array.isArray(p.preview?.detected)) throw new Error("POLICY_UNAVAILABLE");
      if (!active) return;
      setPolicy(s.columns); setColumns(c.columns.map(c => c.columnName));
      setParameters(p.parameters.filter(parameter => p.preview.detected.includes(parameter.name)));
      setLoaded(true);
    })().catch(() => { if (active) setMessage("無法確認 Query 參數或 Dataset 保護規則；已保留原設定，暫停欄位規則編輯。請重新載入。" ); });
    return () => { active = false; scope.current++; };
  }, [dashboardId, selectedQueryId, legacyDatasetId, sourceKey, accessToken]);
  let values: Record<string, unknown> = {}; let masks: Record<string, unknown> = {}; let types: Record<string, unknown> = {}; let valid = true;
  try { values = queryParameterValues(objectJson(parametersJson)); masks = sourceKey === "PRIMARY" ? objectJson(masksJson) : objectJson(JSON.stringify(objectJson(sourceMasksJson)[sourceKey] ?? {})); types = sourceKey === "PRIMARY" ? objectJson(typesJson) : {}; } catch { valid = false; }
  const matching = policy.filter(rule => rule.columnName.toUpperCase() === column.toUpperCase());
  const existing = Object.entries(masks).filter(([key]) => key.toUpperCase() === column.toUpperCase());
  const classified = Object.entries(types).some(([key, type]) => key.toUpperCase() === column.toUpperCase() && type !== "OTHER");
  const allowed = (candidate: string) => loaded && valid && managed !== undefined && !saving && (managed === null || managed.editable) && matching.length <= 1 && existing.length <= 1
    && (existing[0]?.[1] === undefined || (typeof existing[0]?.[1] === "string" && Object.prototype.hasOwnProperty.call(modeNames, existing[0]![1] as string)))
    && (!classified || (candidate !== "NONE" && !(candidate === "INHERIT" && matching[0]?.deviceMaskMode === "NONE"))) && datasetApprovalAllowed(candidate, matching[0]);
  const names = [...new Set([...parameters.map(p => p.name), ...Object.keys(values)])];
  const updateParameter = (name: string, value: unknown) => {
    try { const full = objectJson(parametersJson); onChange({ parametersJson: JSON.stringify({ ...full, [name]: value }, null, 2) }); }
    catch { setMessage("查詢參數 JSON 格式錯誤；原内容保留。" ); }
  };
  const addRule = async () => {
    if (!allowed(mode) || !column) { setMessage("不能降低 Dataset 保護規則。"); return; }
    const current = existing[0]?.[1];
    if (current !== undefined && !maskAtLeastAsStrong(mode, current) && !(mode === "INHERIT" && current === matching[0]?.deviceMaskMode)
      && !window.confirm("這會變更 Dashboard 已保存的額外保護。Dataset 最低政策仍由後端強制執行，確定由管理者明確變更？")) return;
    const name = existing[0]?.[0] ?? column;
    const next = { ...masks, [name]: mode };
    const patch = sourceKey === "PRIMARY" ? {
      deviceColumnMasksJson: JSON.stringify(next, null, 2),
      deviceColumnTypesJson: JSON.stringify({ ...types, [name]: types[name] ?? matching[0]?.sensitivityType ?? "OTHER" }, null, 2),
    } : { deviceSourceColumnMasksJson: JSON.stringify({ ...objectJson(sourceMasksJson), [sourceKey]: next }, null, 2) };
    if (managed && dashboardId) {
      const sequence = scope.current;
      setSaving(true);
      try {
        const result = await apiRequest<{ version: string }>(`/dashboards/${dashboardId}/query-sources/v1/disclosure`, {
          method: "PATCH", body: JSON.stringify({ expectedVersion: managed.version, sourceKey, masks: next }),
        }, accessToken);
        if (sequence !== scope.current) return;
        onChange(patch); setManaged(previous => previous ? { ...previous, version: result.version } : previous);
        window.dispatchEvent(new CustomEvent("uqp.dashboard.configuration.changed", { detail: { dashboardId, origin: "sources" } }));
        setMessage("本來源欄位核准已安全儲存；Dataset 遮蔽由後端執行。");
      } catch (error) { if (sequence === scope.current) setMessage(managementError(error)); }
      finally { if (sequence === scope.current) setSaving(false); }
    } else { onChange(patch); setMessage("欄位規則已加入草稿；請儲存 Dashboard。實際遮蔽由後端執行。"); }
  };
  return <div className="wide">
    <label>遮蔽核准來源<select aria-label="遮蔽核准來源" value={sourceKey} onChange={e => setSourceKey(e.target.value)} disabled={saving}>
      <option value="PRIMARY">PRIMARY 主來源</option>{sources.map(source => <option key={source.sourceKey} value={source.sourceKey}>{source.sourceKey}</option>)}
    </select></label>
    {sourceKey === "PRIMARY" && <div><h3>查詢參數</h3>
    <p>只顯示查詢參數；遮蔽、快照與播放設定分開管理。未編輯的設定不會自動轉換。</p>
    {valid && names.map(name => {
      const definition = parameters.find(p => p.name === name);
      const value = values[name];
      const type = definition?.dataType ?? (typeof value === "number" ? "NUMBER" : typeof value === "boolean" ? "BOOLEAN" : "STRING");
      const complex = value !== null && typeof value === "object";
      return <label key={name}>{name}（{type}{definition?.isRequired ? "，必填" : ""}）
        {complex ? <span>複合值已保留，請用進階查詢參數 JSON 明確編輯。</span> : type === "BOOLEAN"
          ? <select aria-label={`參數 ${name}`} value={value == null ? "" : String(value)} onChange={e => updateParameter(name, e.target.value === "" ? null : e.target.value === "true")}>
            <option value="">未設定</option><option value="true">true</option><option value="false">false</option></select>
          : <input aria-label={`參數 ${name}`} type={type === "NUMBER" ? "number" : "text"} value={value == null ? "" : String(value)} placeholder={definition?.defaultValue ?? "未設定"}
            onChange={e => updateParameter(name, type === "NUMBER" ? e.target.value === "" ? null : Number(e.target.value) : e.target.value)} />}
      </label>;
    })}
    <details><summary>進階查詢參數 JSON（保留舊設定）</summary>
      <textarea aria-label="查詢參數 JSON" value={parametersJson} onChange={e => onChange({ parametersJson: e.target.value })} />
    </details>
    </div>}
    <h3>Dataset 最低保護規則（{sourceKey}）</h3>
    {!loaded && <p role="status">尚未確認 Dataset 保護；暫停欄位規則編輯。</p>}
    {policy.map(rule => <p key={rule.columnName}>{rule.columnName}：{modeNames[rule.deviceMaskMode] ?? "未知規則，禁止變更"}
      {rule.customMask ? `（前 ${rule.customMask.prefix}／後 ${rule.customMask.suffix}，符號 ${rule.customMask.symbol}）` : ""}</p>)}
    <h3>Dashboard 核准欄位與額外遮蔽</h3>
    <p>未列入 Dashboard 規則的 PRIMARY 欄位不傳送；OMIT 欄位不傳送。不得降低 Dataset 規則。改變既有額外保護須管理者明確確認。此處不修改 Dataset。</p>
    <label>核准欄位<select value={column} onChange={e => { setColumn(e.target.value); setMode("OMIT"); }}>
      <option value="">請選擇欄位</option>
      {[...new Set([...columns, ...policy.map(p => p.columnName), ...Object.keys(masks)])].map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <label>欄位遮蔽模式<select value={mode} onChange={e => setMode(e.target.value)}>
      {modes.map(candidate => <option key={candidate} value={candidate} disabled={!allowed(candidate)}>{modeNames[candidate]}</option>)}
    </select></label>
    {column && matching.length === 0 && <p role="status">Dataset 尚未定義此欄位的政策；不可核准傳送，原 JSON 保留。</p>}
    <p role="status">合成資料預覽：{mode === "INHERIT" ? inheritedMaskSample(matching[0]) : mode === "OMIT" ? "欄位不傳送" : mode === "FULL" ? "○○○○" : mode === "NONE" ? "合成非敏感文字" : ({ NAME: "測○料", MRN: "0000○○34", PHONE: "0912○○○678", GENERIC: "測○○料" } as Record<string, string>)[mode]}。Dataset 規則仍為最低要求。</p>
    <button type="button" disabled={!column || !allowed(mode)} onClick={() => void addRule()}>加入／更新 Dashboard 欄位規則</button>
    <table><thead><tr><th>欄位</th><th>已保存／編輯中的規則</th></tr></thead><tbody>{Object.entries(masks).map(([name, value]) => <tr key={name}><td>{name}</td><td>{modeNames[String(value)] ?? "未知舊規則：保留，需管理者審查"}</td></tr>)}</tbody></table>
    <details><summary>既有遮蔽 JSON（唯讀保留）</summary><pre>{sourceKey === "PRIMARY" ? masksJson : JSON.stringify(masks, null, 2)}</pre>{sourceKey === "PRIMARY" && <pre>{typesJson}</pre>}</details>
    {message && <p role="status">{message}</p>}
    {!valid && <p role="alert">舊 JSON 無法安全解析，未轉換或清除任何規則。請管理者審查。</p>}
  </div>;
}
