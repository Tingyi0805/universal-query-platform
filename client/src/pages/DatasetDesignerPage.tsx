import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DatasetParametersEditor } from "../components/DatasetParametersEditor";
import { VersionHistoryPanel } from "../components/VersionHistoryPanel";
import "./DatasetDesignerPage.css";

type DataSourceOption = {
  id: number;
  code: string;
  name: string;
  type: "SQLSERVER" | "ORACLE" | "MYSQL" | "POSTGRESQL" | "ODBC";
};

type DatasetRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  dataSourceId: number;
  dataSourceName?: string;
  dataSourceType?: "SQLSERVER" | "ORACLE" | "MYSQL" | "POSTGRESQL" | "ODBC";
  sqlText: string;
  maxRows: number;
  queryTimeoutSec: number | null;
  isActive: boolean;
  isArchived: boolean;
  archivedAtUtc: string | null;
  archivedByUserId: number | null;
  parameterNames: string[];
};

type PreviewParameter = {
  name: string;
  label: string;
  dataType: "STRING" | "NUMBER" | "DATE" | "DATETIME" | "BOOLEAN";
  controlType: "TEXT" | "NUMBER" | "DATE" | "DATETIME" | "SELECT" | "MULTISELECT" | "CHECKBOX";
  isRequired: boolean;
  defaultValue: string | null;
  optionMode: "NONE" | "FIXED" | "DATASET";
};

type PreviewOption = { value: unknown; label: string };

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
  isArchived: boolean;
  archivedAtUtc: string | null;
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
  isArchived: false,
  archivedAtUtc: null,
};

function extractParameters(sqlText: string): string[] {
  return [...new Set(Array.from(sqlText.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g), (match) => match[1]))];
}

export function DatasetDesignerPage() {
  const { accessToken } = useAuth();
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceOption[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({});
  const [previewParameters, setPreviewParameters] = useState<PreviewParameter[]>([]);
  const [previewOptions, setPreviewOptions] = useState<Record<string, PreviewOption[]>>({});
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  const [datasetFilter, setDatasetFilter] = useState<"ACTIVE" | "INACTIVE" | "ARCHIVED">("ACTIVE");

  const filteredDatasets = datasets.filter((dataset) =>
    datasetFilter === "ARCHIVED"
      ? dataset.isArchived
      : datasetFilter === "ACTIVE"
        ? !dataset.isArchived && dataset.isActive
        : !dataset.isArchived && !dataset.isActive
  );

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
  const loadPreviewParameterDefinitions = useCallback(async (datasetId?: number) => {
    if (!datasetId) {
      setPreviewParameters([]);
      setPreviewOptions({});
      return;
    }

    try {
      const result = await apiRequest<{ parameters: PreviewParameter[] }>(
        `/datasets/${datasetId}/parameters`,
        {},
        accessToken,
      );
      setPreviewParameters(result.parameters);

      const optionParameters = result.parameters.filter((parameter) =>
        ["SELECT","MULTISELECT"].includes(parameter.controlType) && parameter.optionMode !== "NONE"
      );

      const optionEntries = await Promise.all(optionParameters.map(async (parameter) => {
        const response = await apiRequest<{ options: PreviewOption[] }>(
          `/datasets/${datasetId}/parameters/${parameter.name}/options`,
          {},
          accessToken,
        );
        return [parameter.name, response.options] as const;
      }));

      setPreviewOptions(Object.fromEntries(optionEntries));
    } catch {
      setPreviewParameters([]);
      setPreviewOptions({});
    }
  }, [accessToken]);

  useEffect(() => { void loadPreviewParameterDefinitions(form.id); }, [form.id, loadPreviewParameterDefinitions]);


  function resetForm() {
    setForm(emptyForm);
    setParameterValues({});
    setPreviewParameters([]);
    setPreviewOptions({});
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
      isArchived: dataset.isArchived,
      archivedAtUtc: dataset.archivedAtUtc,
    });
    setParameterValues({});
    setPreview(null);
    setError("");
    setNotice("");
    void loadPreviewParameterDefinitions(dataset.id);
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
    if (form.isArchived) {
      setError("此 Dataset 已封存，請先還原後再修改。");
      return;
    }
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
      await loadPreviewParameterDefinitions(form.id);
      setVersionRefreshKey((current) => current + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存 Dataset 失敗。");
    } finally {
      setBusy(false);
    }
  }

  function renderPreviewParameter(name: string) {
    const definition = previewParameters.find((parameter) => parameter.name === name);
    const value = parameterValues[name];

    if (!definition) {
      return (
        <input
          value={String(value ?? "")}
          placeholder="預覽測試值"
          onChange={(e) => setParameterValues({ ...parameterValues, [name]: e.target.value })}
        />
      );
    }

    if (definition.controlType === "MULTISELECT") {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <select
          multiple
          value={selected}
          size={Math.min(Math.max((previewOptions[name] ?? []).length, 3), 8)}
          onChange={(e) => setParameterValues({
            ...parameterValues,
            [name]: Array.from(e.target.selectedOptions, (option) => option.value),
          })}
        >
          {(previewOptions[name] ?? []).map((option, index) => (
            <option key={index} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
      );
    }

    if (definition.controlType === "SELECT") {
      return (
        <select
          value={String(value ?? "")}
          onChange={(e) => setParameterValues({ ...parameterValues, [name]: e.target.value })}
        >
          <option value="">請選擇</option>
          {(previewOptions[name] ?? []).map((option, index) => (
            <option key={index} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
      );
    }

    if (definition.controlType === "CHECKBOX") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => setParameterValues({ ...parameterValues, [name]: e.target.checked })}
        />
      );
    }

    const inputType =
      definition.controlType === "NUMBER" ? "number" :
      definition.controlType === "DATE" ? "date" :
      definition.controlType === "DATETIME" ? "datetime-local" :
      "text";

    return (
      <input
        type={inputType}
        value={String(value ?? definition.defaultValue ?? "")}
        placeholder="預覽測試值"
        onChange={(e) => setParameterValues({ ...parameterValues, [name]: e.target.value })}
      />
    );
  }

  async function runPreview() {
    const quotedParameter = form.sqlText.match(/'\s*\{\{([A-Z][A-Z0-9_]*)\}\}\s*'/);
    if (quotedParameter?.[1]) {
      setError(`參數 {{${quotedParameter[1]}}} 外面不可加單引號，請直接使用 {{${quotedParameter[1]}}}。`);
      setNotice("");
      return;
    }

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
        parameterNames.map((name) => {
          const definition = previewParameters.find((parameter) => parameter.name === name);
          const fallback =
            definition?.controlType === "MULTISELECT" ? [] :
            definition?.controlType === "CHECKBOX" ? false :
            definition?.defaultValue ?? "";
          return [name, parameterValues[name] ?? fallback];
        }),
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
          maxRows: Math.min(Number(form.maxRows), 10000),
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

  async function archiveSelected() {
    if (!form.id || form.isArchived) return;
    if (!window.confirm(`確定封存 Dataset「${form.name}」？封存後會停用，引用它的已發佈 Query 也會自動取消發佈。`)) return;

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ status: string; dataset: DatasetRow }>(
        `/datasets/${form.id}/archive`,
        { method: "POST" },
        accessToken,
      );
      selectDataset(result.dataset);
      setDatasetFilter("ARCHIVED");
      setNotice("Dataset 已封存；相關已發佈 Query 已自動取消發佈。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "封存 Dataset 失敗。");
    } finally {
      setBusy(false);
    }
  }

  async function restoreSelected() {
    if (!form.id || !form.isArchived) return;
    if (!window.confirm(`確定還原 Dataset「${form.name}」？還原後會維持停用，請確認設定後再啟用。`)) return;

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<{ status: string; dataset: DatasetRow }>(
        `/datasets/${form.id}/restore`,
        { method: "POST" },
        accessToken,
      );
      selectDataset(result.dataset);
      setDatasetFilter("INACTIVE");
      setNotice("Dataset 已還原，目前為停用狀態。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "還原 Dataset 失敗。");
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
          `Dataset「${form.name}」目前仍被 ${details} 使用，不能永久刪除，請改用「封存」。`,
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

          <div className="dataset-status-filter" role="tablist" aria-label="Dataset 狀態">
            <button type="button" className={datasetFilter === "ACTIVE" ? "active" : ""}
              onClick={() => { setDatasetFilter("ACTIVE"); resetForm(); }}>
              啟用 <span>{datasets.filter((d) => !d.isArchived && d.isActive).length}</span>
            </button>
            <button type="button" className={datasetFilter === "INACTIVE" ? "active" : ""}
              onClick={() => { setDatasetFilter("INACTIVE"); resetForm(); }}>
              停用 <span>{datasets.filter((d) => !d.isArchived && !d.isActive).length}</span>
            </button>
            <button type="button" className={datasetFilter === "ARCHIVED" ? "active" : ""}
              onClick={() => { setDatasetFilter("ARCHIVED"); resetForm(); }}>
              已封存 <span>{datasets.filter((d) => d.isArchived).length}</span>
            </button>
          </div>

          {loading ? <div className="notice">載入中…</div> : filteredDatasets.map((dataset) => (
            <button
              type="button"
              className={`dataset-item ${form.id === dataset.id ? "selected" : ""}`}
              key={dataset.id}
              onClick={() => selectDataset(dataset)}
            >
              <strong>{dataset.name}</strong>
              <small>{dataset.code}</small>
              <span>
                {dataset.dataSourceName} · {dataset.dataSourceType} · {dataset.isArchived ? "已封存" : dataset.isActive ? "啟用" : "停用"}
              </span>
            </button>
          ))}

          {!loading && filteredDatasets.length === 0 && <div className="empty-state">此狀態目前沒有 Dataset。</div>}
        </aside>

        <section className="designer-editor">
          <form className={form.isArchived ? "archived-form" : ""} onSubmit={save}>
            <div className="section-title">
              <h2>{form.id ? "編輯 Dataset" : "新增 Dataset"}</h2>
              {form.isArchived ? (
                <span className="dataset-archive-badge">Archived</span>
              ) : (
              <label className="inline-check">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                啟用
              </label>
              )}
            </div>

            {form.isArchived && (
              <div className="archive-notice">
                此 Dataset 已封存，只供查閱。{form.archivedAtUtc ? `封存時間：${new Date(form.archivedAtUtc).toLocaleString("zh-TW")}` : ""}
              </div>
            )}

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
              <small className="field-hint">Bind Parameter 請直接寫 <code>{"{{PARAM}}"}</code>，不要寫成 <code>{"'{{PARAM}}'"}</code>。</small>
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
                  {parameterNames.map((name) => {
                    const definition = previewParameters.find((parameter) => parameter.name === name);
                    return (
                      <label key={name}>
                        {definition?.label || name}
                        {renderPreviewParameter(name)}
                        {definition?.controlType === "MULTISELECT" && (
                          <small className="field-hint">可按 Ctrl（Mac：Command）選取多個值。</small>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="form-actions">
              {!form.isArchived ? (
                <>
                  <button className="primary-button" disabled={busy} type="submit">
                    {busy ? "處理中…" : "儲存 Dataset"}
                  </button>
                  <button className="secondary-button" disabled={busy} type="button" onClick={() => void runPreview()}>
                    執行預覽
                  </button>
                  {form.id && (
                    <button className="secondary-button" disabled={busy} type="button" onClick={() => void archiveSelected()}>
                      封存
                    </button>
                  )}
                  {form.id && (
                    <button className="danger-button" disabled={busy} type="button" onClick={() => void remove()}>
                      永久刪除
                    </button>
                  )}
                </>
              ) : (
                <button className="secondary-button" disabled={busy} type="button" onClick={() => void restoreSelected()}>
                  還原為停用
                </button>
              )}
            </div>
          </form>

          {form.id && (
            <VersionHistoryPanel
              basePath={`/datasets/${form.id}`}
              entityLabel={`Dataset「${form.name}」`}
              refreshKey={versionRefreshKey}
              disabled={form.isArchived}
              onRestored={async () => {
                const result = await apiRequest<{ dataset: DatasetRow }>(
                  `/datasets/${form.id}`,
                  {},
                  accessToken,
                );
                selectDataset(result.dataset);
                setDatasetFilter("INACTIVE");
                setVersionRefreshKey((current) => current + 1);
                await load();
              }}
            />
          )}

          {form.id && !form.isArchived && (
            <DatasetParametersEditor
              datasetId={form.id}
              datasets={datasets
                .filter((dataset) => !dataset.isArchived)
                .map((dataset) => ({ id: dataset.id, code: dataset.code, name: dataset.name }))}
              onChanged={async () => {
                await loadPreviewParameterDefinitions(form.id);
                setVersionRefreshKey((current) => current + 1);
              }}
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
