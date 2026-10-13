import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { maskAtLeastAsStrong, objectJson, queryParameterValues } from "../dashboard/dataSettings";

type Rule = { columnName: string; sensitivityType: string; deviceMaskMode: string; customMask?: { prefix: number; suffix: number; symbol: string } | null };
type Parameter = { name: string; label: string; dataType: string; isRequired: boolean; defaultValue: string | null };
const modes = ["NONE", "NAME", "MRN", "PHONE", "GENERIC", "FULL", "OMIT"];
const modeNames: Record<string, string> = { NONE: "原樣顯示（非敏感欄位）", NAME: "姓名部分遮蔽", MRN: "病歷號部分遮蔽", PHONE: "電話部分遮蔽", GENERIC: "一般部分遮蔽", FULL: "全部遮蔽", OMIT: "不傳送", CUSTOM: "Dataset 自訂遮蔽" };
export function DashboardDataSettingsEditor({ queryId, accessToken, parametersJson, masksJson, typesJson, onChange }: {
  queryId: number; accessToken: string | null; parametersJson: string; masksJson: string; typesJson: string;
  onChange: (patch: { parametersJson?: string; deviceColumnMasksJson?: string; deviceColumnTypesJson?: string }) => void;
}) {
  const [policy, setPolicy] = useState<Rule[]>([]);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [column, setColumn] = useState("");
  const [mode, setMode] = useState("OMIT");
  useEffect(() => {
    let active = true;
    setLoaded(false); setPolicy([]); setColumns([]); setParameters([]); setColumn(""); setMessage("");
    if (!queryId) return () => { active = false; };
    void (async () => {
      const q = await apiRequest<{ queryDefinition: { datasetId: number } }>(`/query-definitions/${queryId}`, {}, accessToken);
      if (!Number.isSafeInteger(q.queryDefinition?.datasetId) || q.queryDefinition.datasetId < 1) throw new Error("QUERY_METADATA_UNAVAILABLE");
      const [p, s, c] = await Promise.all([
        apiRequest<{ parameters: Parameter[]; preview: { detected: string[] } }>(`/datasets/${q.queryDefinition.datasetId}/parameters`, {}, accessToken),
        apiRequest<{ columns: Rule[]; version: number }>(`/datasets/${q.queryDefinition.datasetId}/sensitive-columns`, {}, accessToken),
        apiRequest<{ columns: Array<{ columnName: string }> }>(`/query-definitions/${queryId}/report-columns`, {}, accessToken),
      ]);
      if (!Array.isArray(s.columns) || !Number.isSafeInteger(s.version) || s.version < 0 || (s.version === 0 && s.columns.length === 0) || !Array.isArray(p.preview?.detected)) throw new Error("POLICY_UNAVAILABLE");
      if (!active) return;
      setPolicy(s.columns); setColumns(c.columns.map(c => c.columnName));
      setParameters(p.parameters.filter(parameter => p.preview.detected.includes(parameter.name)));
      setLoaded(true);
    })().catch(() => { if (active) setMessage("無法確認 Query 參數或 Dataset 保護規則；已保留原設定，暫停欄位規則編輯。請重新載入。" ); });
    return () => { active = false; };
  }, [queryId, accessToken]);
  let values: Record<string, unknown> = {}; let masks: Record<string, unknown> = {}; let types: Record<string, unknown> = {}; let valid = true;
  try { values = queryParameterValues(objectJson(parametersJson)); masks = objectJson(masksJson); types = objectJson(typesJson); } catch { valid = false; }
  const matching = policy.filter(rule => rule.columnName.toUpperCase() === column.toUpperCase());
  const existing = Object.entries(masks).filter(([key]) => key.toUpperCase() === column.toUpperCase());
  const classified = Object.entries(types).some(([key, type]) => key.toUpperCase() === column.toUpperCase() && type !== "OTHER");
  const allowed = (candidate: string) => loaded && valid && matching.length <= 1 && existing.length <= 1
    && (!classified || candidate !== "NONE") && maskAtLeastAsStrong(candidate, existing[0]?.[1])
    && matching.every(rule => maskAtLeastAsStrong(candidate, rule.deviceMaskMode) && (rule.sensitivityType === "OTHER" || candidate !== "NONE"));
  const names = [...new Set([...parameters.map(p => p.name), ...Object.keys(values)])];
  const updateParameter = (name: string, value: unknown) => {
    try { const full = objectJson(parametersJson); onChange({ parametersJson: JSON.stringify({ ...full, [name]: value }, null, 2) }); }
    catch { setMessage("查詢參數 JSON 格式錯誤；原内容保留。" ); }
  };
  const addRule = () => {
    if (!allowed(mode) || !column) { setMessage("不能降低既有或 Dataset 保護規則。" ); return; }
    const name = existing[0]?.[0] ?? column;
    // Preserve all other columns, classifications, spelling and unknown legal parameters.
    onChange({ deviceColumnMasksJson: JSON.stringify({ ...masks, [name]: mode }, null, 2),
      deviceColumnTypesJson: JSON.stringify({ ...types, [name]: types[name] ?? matching[0]?.sensitivityType ?? "OTHER" }, null, 2) });
    setMessage("欄位規則已加入草稿；請儲存 Dashboard。實際遮蔽由後端執行。" );
  };
  return <div className="wide">
    <h3>查詢參數</h3>
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
    <h3>Dataset 最低保護規則</h3>
    {!loaded && <p role="status">尚未確認 Dataset 保護；暫停欄位規則編輯。</p>}
    {policy.map(rule => <p key={rule.columnName}>{rule.columnName}：{modeNames[rule.deviceMaskMode] ?? "未知規則，禁止變更"}
      {rule.customMask ? `（前 ${rule.customMask.prefix}／後 ${rule.customMask.suffix}，符號 ${rule.customMask.symbol}）` : ""}</p>)}
    <h3>Dashboard 核准欄位與額外遮蔽</h3>
    <p>未列入 Dashboard 規則的 PRIMARY 欄位不傳送；OMIT 欄位不傳送。不得降低 Dataset 或既有規則。此處不修改 Dataset。</p>
    <label>核准欄位<select value={column} onChange={e => { setColumn(e.target.value); setMode("OMIT"); }}>
      <option value="">請選擇欄位</option>
      {[...new Set([...columns, ...policy.map(p => p.columnName), ...Object.keys(masks)])].map(name => <option key={name} value={name}>{name}</option>)}
    </select></label>
    <label>欄位遮蔽模式<select value={mode} onChange={e => setMode(e.target.value)}>
      {modes.map(candidate => <option key={candidate} value={candidate} disabled={!allowed(candidate)}>{modeNames[candidate]}</option>)}
    </select></label>
    <p role="status">合成資料預覽：{mode === "OMIT" ? "欄位不傳送" : mode === "FULL" ? "○○○○" : mode === "NONE" ? "合成非敏感文字" : ({ NAME: "測○料", MRN: "0000○○34", PHONE: "0912○○○678", GENERIC: "測○○料" } as Record<string, string>)[mode]}。Dataset 規則仍為最低要求。</p>
    <button type="button" disabled={!column || !allowed(mode)} onClick={addRule}>加入／更新 Dashboard 欄位規則</button>
    <table><thead><tr><th>欄位</th><th>已保存／編輯中的規則</th></tr></thead><tbody>{Object.entries(masks).map(([name, value]) => <tr key={name}><td>{name}</td><td>{modeNames[String(value)] ?? "未知舊規則：保留，需管理者審查"}</td></tr>)}</tbody></table>
    <details><summary>既有遮蔽 JSON（唯讀保留）</summary><pre>{masksJson}</pre><pre>{typesJson}</pre></details>
    {message && <p role="status">{message}</p>}
    {!valid && <p role="alert">舊 JSON 無法安全解析，未轉換或清除任何規則。請管理者審查。</p>}
  </div>;
}
