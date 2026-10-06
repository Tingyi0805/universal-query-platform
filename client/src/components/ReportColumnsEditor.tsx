import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./ReportColumnsEditor.css";

type ReportColumn = {
  columnName: string;
  dataType: string | null;
  displayLabel: string;
  displayOrder: number;
  isVisible: boolean;
  width: number | null;
  displayFormat: string | null;
  alignment: "LEFT" | "CENTER" | "RIGHT";
  groupOrder: number | null;
  aggregateType: "NONE" | "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";
};

export function ReportColumnsEditor({ queryId }: { queryId: number }) {
  const { accessToken } = useAuth();
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<{ columns: ReportColumn[] }>(
        `/query-definitions/${queryId}/report-columns`,
        {},
        accessToken,
      );
      setColumns(result.columns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Report 欄位失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, queryId]);

  useEffect(() => { void load(); }, [load]);

  function update(index: number, patch: Partial<ReportColumn>) {
    setColumns((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;

    setColumns((rows) => {
      const copy = [...rows];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy.map((row, displayOrder) => ({ ...row, displayOrder }));
    });
  }

  async function save() {
    setError("");
    setNotice("");
    try {
      await apiRequest(`/query-definitions/${queryId}/report-columns`, {
        method: "PUT",
        body: JSON.stringify({
          columns: columns.map((column, index) => ({
            columnName: column.columnName,
            displayLabel: column.displayLabel,
            displayOrder: index,
            isVisible: column.isVisible,
            width: column.width,
            displayFormat: column.displayFormat || null,
            alignment: column.alignment,
            groupOrder: column.groupOrder,
            aggregateType: column.aggregateType,
          })),
        }),
      }, accessToken);
      setNotice("Report 欄位設定已儲存。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Report 欄位失敗。");
    }
  }

  return (
    <section className="report-columns-editor">
      <div className="section-title">
        <div>
          <h2>Report Designer</h2>
          <p>控制查詢結果與 Excel 的欄位呈現。群組填 1、2、3… 代表群組層級；留白表示不群組。</p>
        </div>
        <div className="report-actions">
          <button className="secondary-button" type="button" onClick={() => void load()}>重新讀取欄位</button>
          {columns.length > 0 && <button className="primary-button" type="button" onClick={() => void save()}>儲存版面</button>}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {loading ? (
        <div className="notice">欄位載入中…</div>
      ) : columns.length === 0 ? (
        <div className="empty-state">
          尚未取得 Dataset 輸出欄位。請先到 Query Designer 對此 Dataset 執行一次「預覽」。
        </div>
      ) : (
        <div className="report-column-table-wrap">
          <table className="report-column-table">
            <thead>
              <tr>
                <th>順序</th>
                <th>顯示</th>
                <th>原欄位</th>
                <th>標題</th>
                <th>型別</th>
                <th>寬度</th>
                <th>格式</th>
                <th>對齊</th>
                <th>群組</th>
                <th>彙總</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column, index) => (
                <tr key={column.columnName}>
                  <td>
                    <div className="order-buttons">
                      <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                      <button type="button" disabled={index === columns.length - 1} onClick={() => move(index, 1)}>↓</button>
                    </div>
                  </td>
                  <td><input type="checkbox" checked={column.isVisible} onChange={(e) => update(index, { isVisible: e.target.checked })} /></td>
                  <td><code>{column.columnName}</code></td>
                  <td><input value={column.displayLabel} onChange={(e) => update(index, { displayLabel: e.target.value })} /></td>
                  <td>{column.dataType || "—"}</td>
                  <td><input className="small-input" type="number" min={40} max={1000} value={column.width ?? ""}
                    onChange={(e) => update(index, { width: e.target.value ? Number(e.target.value) : null })} /></td>
                  <td><input className="format-input" placeholder="例如 yyyy/MM/dd"
                    value={column.displayFormat ?? ""} onChange={(e) => update(index, { displayFormat: e.target.value })} /></td>
                  <td>
                    <select className="alignment-select" value={column.alignment} onChange={(e) => update(index, { alignment: e.target.value as ReportColumn["alignment"] })}>
                      <option value="LEFT">左</option>
                      <option value="CENTER">中</option>
                      <option value="RIGHT">右</option>
                    </select>
                  </td>
                  <td><input className="small-input" type="number" min={1} max={100} placeholder="1"
                    title="1 = 第一層群組，2 = 第二層群組；留白 = 不群組"
                    value={column.groupOrder ?? ""}
                    onChange={(e) => update(index, { groupOrder: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td>
                    <select className="aggregate-select" value={column.aggregateType}
                      onChange={(e) => update(index, { aggregateType: e.target.value as ReportColumn["aggregateType"] })}>
                      {["NONE","SUM","AVG","MIN","MAX","COUNT"].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
