import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DatasetParametersEditor } from "../components/DatasetParametersEditor";
import "./DatasetDesignerPage.css";

type DataSourceOption = {
  id: number;
  code: string;
  name: string;
  type: "SQLSERVER" | "ORACLE";
};

type DatasetRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  dataSourceId: number;
  dataSourceName?: string;
  dataSourceType?: "SQLSERVER" | "ORACLE";
  sqlText: string;
  maxRows: number;
  queryTimeoutSec: number | null;
  isActive: boolean;
  parameterNames: string[];
};

type QueryResult = {
  columns: { name: string; dataType?: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

type FormState = {
  id?: number;
  code: string;
  name: string;
  description: string;
  dataSourceId: number | "";
  sqlText: string;
  maxRows: number;
  queryTimeoutSec: number | "";
  isActive: boolean;
};

const emptyForm: FormState = {
  code: "",
  name: "",
  description: "",
  dataSourceId: "",
  sqlText: "SELECT\n  *\nFROM YOUR_TABLE\nWHERE 1 = 1",
  maxRows: 500,
  queryTimeoutSec: "",
  isActive: true,
};

function extractParameters(sqlText: string): string[] {
  return [...new Set(Array.from(sqlText.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g), (match) => match[1]))];
}

export function DatasetDesignerPage() {
  const { accessToken } = useAuth();
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceOption[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const parameterNames = useMemo(() => extractParameters(form.sqlText), [form.sqlText]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [datasetResult, dataSourceResult] = await Promise.all([
        apiRequest<{ datasets: DatasetRow[] }>("/datasets", {}, accessToken),
        apiRequest<{ dataSources: DataSourceOption[] }>("/datasets/datasource-options", {}, accessToken),
      ]);
      setDatasets(datasetResult.datasets);
      setDataSources(dataSourceResult.dataSources);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入 Dataset 失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setForm(emptyForm);
    setParameterValues({});
    setPreview(null);
    setError("");
    setNotice("");
  }

  function selectDataset(dataset: DatasetRow) {
    setForm({
      id: dataset.id,
      code: dataset.code,
      name: dataset.name,
      description: dataset.description ?? "",
      dataSourceId: dataset.dataSourceId,
      sqlText: dataset.sqlText,
      maxRows: dataset.maxRows,
      queryTimeoutSec: dataset.queryTimeoutSec ?? "",
      isActive: dataset.isActive,
    });
    setParameterValues({});
    setPreview(null);
    setError("");
    setNotice("");
  }

  const payload = () => ({
    code: form.code.trim().toUpperCase(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    dataSourceId: Number(form.dataSourceId),
    sqlText: form.sqlText,
    maxRows: Number(form.maxRows),
    queryTimeoutSec: form.queryTimeoutSec === "" ? null : Number(form.queryTimeoutSec),
    isActive: form.isActive,
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (!form.dataSourceId) {
        setError("請選擇資料來源。");
        return;
      }

      if (form.id) {
        await apiRequest(`/datasets/${form.id}`, {
          method: "PUT",
          body: JSON.stringify(payload()),
        }, accessToken);
        setNotice("Dataset 已更新。");
      } else {
        const created = await apiRequest<{ id: number; parameterNames: string[] }>("/datasets", {
          method: "POST",
          body: JSON.stringify(payload()),
        }, accessToken);
        setForm((current) => ({ ...current, id: created.id }));
        setNotice("Dataset 已建立。");
      }

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Dataset 失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);

    try {
      if (!form.dataSourceId) {
        setError("請選擇資料來源。");
        return;
      }

      const values = Object.fromEntries(
        parameterNames.map((name) => [name, parameterValues[name] ?? ""]),
      );

      const response = await apiRequest<{
        result: QueryResult;
        parameterNames: string[];
      }>("/datasets/preview/run", {
        method: "POST",
        body: JSON.stringify({
          dataSourceId: Number(form.dataSourceId),
          sqlText: form.sqlText,
          values,
          maxRows: Math.min(Number(form.maxRows), 1000),
          queryTimeoutSec: form.queryTimeoutSec === "" ? null : Number(form.queryTimeoutSec),
          ...(form.id ? { datasetId: form.id } : {}),
        }),
      }, accessToken);

      setPreview(response.result);
      setNotice(`預覽完成：${response.result.rowCount} 筆，${response.result.elapsedMs} ms${response.result.truncated ? "（結果已截斷）" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "查詢預覽失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!form.id) return;

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const impact = await apiRequest<{
        canDelete: boolean;
        queryCount: number;
        lookupReferenceCount: number;
      }>(`/datasets/${form.id}/delete-impact`, {}, accessToken);

      if (!impact.canDelete) {
        const details = [
          impact.queryCount > 0 ? `${impact.queryCount} 個 Query` : "",
          impact.lookupReferenceCount > 0 ? `${impact.lookupReferenceCount} 個參數選項來源` : "",
        ].filter(Boolean).join("、");

        setError(
          `Dataset「${form.name}」目前仍被 ${details} 使用，不能直接刪除。請先解除關聯，或取消「啟用」後儲存。`,
        );
        return;
      }

      if (!window.confirm(`確定永久刪除 Dataset「${form.name}」？此操作無法復原。`)) return;

      await apiRequest(`/datasets/${form.id}`, { method: "DELETE" }, accessToken);
      resetForm();
      setNotice("Dataset 已刪除。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除 Dataset 失敗。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-shell dataset-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">Query Designer</p>
          <h1>Dataset / Query Designer</h1>
          <p className="subtitle">建立唯讀 Dataset，使用 <code>{"{{PARAM_NAME}}"}</code> 定義安全 Bind Parameter。</p>
        </div>
        <Link className="secondary-button link-button" to="/">返回首頁</Link>
      </div>

      {error && <section className="form-error">{error}</section>}
      {notice && <section className="notice">{notice}</section>}

      <div className="designer-layout">
        <aside className="dataset-list">
          <div className="section-title">
            <h2>Datasets</h2>
            <button className="secondary-button" type="button" onClick={resetForm}>＋新增</button>
          </div>

          {loading ? <div className="notice">載入中…</div> : datasets.map((dataset) => (
            <button
              type="button"
              className={`dataset-item ${form.id === dataset.id ? "selected" : ""}`}
              key={dataset.id}
              onClick={() => selectDataset(dataset)}
            >
              <strong>{dataset.name}</strong>
              <small>{dataset.code}</small>
              <span>{dataset.dataSourceName} · {dataset.dataSourceType}</span>
            </button>
          ))}

          {!loading && datasets.length === 0 && <div className="empty-state">尚未建立 Dataset。</div>}
        </aside>

        <section className="designer-editor">
          <form onSubmit={save}>
            <div className="section-title">
              <h2>{form.id ? "編輯 Dataset" : "新增 Dataset"}</h2>
              <label className="inline-check">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                啟用
              </label>
            </div>

            <div className="form-grid two">
              <label>代碼
                <input value={form.code} disabled={Boolean(form.id)}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </label>
              <label>名稱
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
            </div>

            <label>說明
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>

            <div className="form-grid three">
              <label>資料來源
                <select value={form.dataSourceId}
                  onChange={(e) => setForm({ ...form, dataSourceId: e.target.value ? Number(e.target.value) : "" })}>
                  <option value="">請選擇</option>
                  {dataSources.map((source) => (
                    <option value={source.id} key={source.id}>
                      {source.name} ({source.type})
                    </option>
                  ))}
                </select>
              </label>
              <label>最大筆數
                <input type="number" min={1} max={10000} value={form.maxRows}
                  onChange={(e) => setForm({ ...form, maxRows: Number(e.target.value) })} />
              </label>
              <label>Timeout（秒）
                <input type="number" min={1} max={3600} placeholder="沿用 DataSource"
                  value={form.queryTimeoutSec}
                  onChange={(e) => setForm({ ...form, queryTimeoutSec: e.target.value ? Number(e.target.value) : "" })} />
              </label>
            </div>

            <label className="sql-label">
              SQL（僅允許 SELECT / WITH）
              <textarea spellCheck={false} value={form.sqlText}
                onChange={(e) => setForm({ ...form, sqlText: e.target.value })} />
            </label>

            <div className="parameter-panel">
              <div>
                <strong>偵測到的參數</strong>
                <p>語法：<code>{"{{PARAM_NAME}}"}</code></p>
              </div>
              {parameterNames.length === 0 ? (
                <span className="muted">此 SQL 沒有參數。</span>
              ) : (
                <div className="parameter-grid">
                  {parameterNames.map((name) => (
                    <label key={name}>
                      {name}
                      <input value={parameterValues[name] ?? ""}
                        placeholder="預覽測試值"
                        onChange={(e) => setParameterValues({ ...parameterValues, [name]: e.target.value })} />
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="form-actions">
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? "處理中…" : "儲存 Dataset"}
              </button>
              <button className="secondary-button" disabled={busy} type="button" onClick={() => void runPreview()}>
                執行預覽
              </button>
              {form.id && (
                <button className="danger-button" disabled={busy} type="button" onClick={() => void remove()}>
                  刪除
                </button>
              )}
            </div>
          </form>

          {form.id && (
            <DatasetParametersEditor
              datasetId={form.id}
              datasets={datasets.map((dataset) => ({ id: dataset.id, code: dataset.code, name: dataset.name }))}
            />
          )}

          {preview && (
            <section className="preview-panel">
              <div className="section-title">
                <h2>預覽結果</h2>
                <span>{preview.rowCount} 筆 · {preview.elapsedMs} ms</span>
              </div>
              <div className="preview-table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      {preview.columns.map((column) => (
                        <th key={column.name}>
                          {column.name}
                          {column.dataType && <small>{column.dataType}</small>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={index}>
                        {preview.columns.map((column) => (
                          <td key={column.name}>{row[column.name] == null ? "" : String(row[column.name])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
