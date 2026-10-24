import { useState } from "react";

type Field = Readonly<{ name: string; dataType: string; ordinal: number }>;
type Draft = Readonly<{ name: string; mode: "CUSTOM" | "FULL" | "OMIT"; prefix: number; suffix: number; symbol: string }>;

const sample = "ABC01234"; // Synthetic only: never use data returned from the DataSource.
function maskExample(draft: Draft): string {
  if (draft.mode === "OMIT") return "（欄位不傳送）";
  if (draft.mode === "FULL") return "○○○○";
  const characters = Array.from(sample);
  if (draft.prefix + draft.suffix >= characters.length) return draft.symbol.repeat(characters.length);
  return characters.slice(0, draft.prefix).join("")
    + draft.symbol.repeat(characters.length - draft.prefix - draft.suffix)
    + (draft.suffix ? characters.slice(-draft.suffix).join("") : "");
}

/**
 * Deliberately local-only UX rehearsal: no API writes, no policy authorization.
 * UNBOUND_CANDIDATE fields cannot become DatasetColumn or trusted sensitivity rules.
 */
export function DatasetCandidateMaskDraft({ columns }: { columns: readonly Field[] }) {
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<Draft["mode"]>("CUSTOM");
  const [prefix, setPrefix] = useState(0);
  const [suffix, setSuffix] = useState(4);
  const [symbol, setSymbol] = useState("○");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const valid = Number.isInteger(prefix) && Number.isInteger(suffix)
    && prefix >= 0 && suffix >= 0 && prefix <= 100 && suffix <= 100
    && Array.from(symbol).length === 1 && !/[\r\n\t]/u.test(symbol);
  const updateSelected = (name: string) => {
    setSelected(name);
    const existing = drafts.find(draft => draft.name === name);
    if (existing) {
      setMode(existing.mode); setPrefix(existing.prefix); setSuffix(existing.suffix); setSymbol(existing.symbol);
    } else {
      setMode("CUSTOM"); setPrefix(0); setSuffix(4); setSymbol("○");
    }
  };
  const add = () => {
    if (!columns.some(column => column.name === selected) || (mode === "CUSTOM" && !valid)) return;
    const draft: Draft = { name: selected, mode, prefix, suffix, symbol };
    setDrafts(previous => [...previous.filter(entry => entry.name !== selected), draft]);
  };
  return <section className="preview-panel" aria-label="候選欄位遮蔽草稿">
    <h4>遮蔽方式草稿（僅本頁試排、不會儲存）</h4>
    <p role="status">這些欄位尚未經來源 Fence 與 Owner 確認。草稿只用合成值示範，離開或更新欄位後即會消失；不會寫入敏感政策、患者稽核或解除資料預覽限制。</p>
    <label>候選欄位
      <select aria-label="候選遮蔽欄位" value={selected} onChange={event => updateSelected(event.target.value)}>
        <option value="">請自行選擇欄位，不自動判斷分類</option>
        {columns.map(column => <option value={column.name} key={column.ordinal}>{column.name}</option>)}
      </select>
    </label>
    <fieldset>
      <legend>草稿遮蔽方式</legend>
      <label><input type="radio" name="candidate-draft-mode" checked={mode === "CUSTOM"} onChange={() => setMode("CUSTOM")}/>自訂遮蔽</label>
      <label><input type="radio" name="candidate-draft-mode" checked={mode === "FULL"} onChange={() => setMode("FULL")}/>全部遮蔽</label>
      <label><input type="radio" name="candidate-draft-mode" checked={mode === "OMIT"} onChange={() => setMode("OMIT")}/>完全不傳送</label>
    </fieldset>
    {mode === "CUSTOM" && <>
      <label>草稿保留前幾碼<input type="number" min={0} max={100} step={1} value={prefix}
        onChange={event => setPrefix(Number(event.target.value))}/></label>
      <label>草稿保留後幾碼<input type="number" min={0} max={100} step={1} value={suffix}
        onChange={event => setSuffix(Number(event.target.value))}/></label>
      <label>草稿遮蔽符號<input type="text" maxLength={2} value={symbol}
        onChange={event => setSymbol(event.target.value)}/></label>
      {!valid && <p role="alert">碼數須為 0～100，符號只能是單一字元。</p>}
    </>}
    <p>合成範例 ABC01234 → {mode === "CUSTOM" && !valid ? "設定無效" : maskExample({ name: selected, mode, prefix, suffix, symbol })}</p>
    <button type="button" disabled={!selected || (mode === "CUSTOM" && !valid)}
      onClick={add}>加入／更新本頁草稿（不儲存）</button>
    {drafts.length > 0 && <table className="preview-table">
      <caption>尚未儲存、未生效的遮蔽草稿</caption>
      <thead><tr><th>欄位</th><th>草稿方式</th><th>模擬結果</th><th>操作</th></tr></thead>
      <tbody>{drafts.map(draft => <tr key={draft.name}>
        <td>{draft.name}</td><td>{draft.mode}</td><td>{maskExample(draft)}</td>
        <td><button type="button" onClick={() => setDrafts(previous => previous.filter(item => item.name !== draft.name))}>移除草稿</button></td>
      </tr>)}</tbody>
    </table>}
  </section>;
}
