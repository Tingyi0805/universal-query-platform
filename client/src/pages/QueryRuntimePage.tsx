import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { apiDownload, apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./QueryRuntimePage.css";

type Query = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  canView: boolean;
  canExecute: boolean;
  canExport: boolean;
};

type Parameter = {
  name: string;
  label: string;
  dataType: "STRING" | "NUMBER" | "DATE" | "DATETIME" | "BOOLEAN";
  controlType: "TEXT" | "NUMBER" | "DATE" | "DATETIME" | "SELECT" | "MULTISELECT" | "CHECKBOX";
  isRequired: boolean;
  defaultValue: string | null;
  displayOrder: number;
  placeholder: string | null;
  helpText: string | null;
  optionMode: "NONE" | "FIXED" | "DATASET";
};

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

type Option = { value: unknown; label: string };

type QueryResult = {
  columns: { name: string; dataType?: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

function formatValue(value: unknown, format: string | null): string {
  if (value == null) return "";
  if (!format) return String(value);

  if (/y{2,4}.*m{1,2}.*d{1,2}/i.test(format)) {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("zh-TW");
  }

  const number = Number(value);
  if (Number.isFinite(number) && format.includes("%")) {
    const decimals = (format.split(".")[1]?.replace(/[^0#]/g, "").length ?? 0);
    return number.toLocaleString(undefined, {
      style: "percent",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  if (Number.isFinite(number) && format.includes("#,##0")) {
    const decimals = format.includes(".") ? format.split(".")[1].replace(/[^0#]/g, "").length : 0;
    return number.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return String(value);
}

function aggregateValue(column: ReportColumn, rows: Record<string, unknown>[]): string {
  if (column.aggregateType === "NONE") return "";

  const values = rows
    .map((row) => row[column.columnName])
    .filter((value) => value !== null && value !== undefined && value !== "");

  if (column.aggregateType === "COUNT") return String(values.length);

  const numbers = values.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return "";

  const value =
    column.aggregateType === "SUM" ? numbers.reduce((sum, item) => sum + item, 0) :
    column.aggregateType === "AVG" ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length :
    column.aggregateType === "MIN" ? Math.min(...numbers) :
    column.aggregateType === "MAX" ? Math.max(...numbers) :
    null;

  return value == null ? "" : formatValue(value, column.displayFormat);
}

type GroupedDisplayRow =
  | { kind: "group"; key: string; level: number; label: string; count: number }
  | { kind: "data"; key: string; row: Record<string, unknown> }
  | { kind: "subtotal"; key: string; level: number; label: string; rows: Record<string, unknown>[] };

function compareGroupValue(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;

  return String(a).localeCompare(String(b), "zh-Hant", { numeric: true });
}

function buildGroupedRows(
  rows: Record<string, unknown>[],
  groupColumns: ReportColumn[],
): GroupedDisplayRow[] {
  if (groupColumns.length === 0) {
    return rows.map((row, index) => ({ kind: "data" as const, key: `data-${index}`, row }));
  }

  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const column of groupColumns) {
        const compared = compareGroupValue(a.row[column.columnName], b.row[column.columnName]);
        if (compared !== 0) return compared;
      }
      return a.index - b.index;
    })
    .map((item) => item.row);

  const output: GroupedDisplayRow[] = [];

  function appendLevel(level: number, levelRows: Record<string, unknown>[], path: string) {
    if (level >= groupColumns.length) {
      levelRows.forEach((row, index) => {
        output.push({ kind: "data", key: `${path}-data-${index}`, row });
      });
      return;
    }

    const column = groupColumns[level];
    const groups = new Map<string, { label: string; rows: Record<string, unknown>[] }>();

    for (const row of levelRows) {
      const raw = row[column.columnName];
      const label = formatValue(raw, column.displayFormat) || "（空白）";
      const key = raw == null ? "__NULL__" : String(raw);
      const existing = groups.get(key);
      if (existing) existing.rows.push(row);
      else groups.set(key, { label, rows: [row] });
    }

    let groupIndex = 0;
    for (const group of groups.values()) {
      const groupPath = `${path}-g${level}-${groupIndex++}`;
      output.push({
        kind: "group",
        key: `${groupPath}-header`,
        level,
        label: `${column.displayLabel}：${group.label}`,
        count: group.rows.length,
      });

      appendLevel(level + 1, group.rows, groupPath);

      output.push({
        kind: "subtotal",
        key: `${groupPath}-subtotal`,
        level,
        label: `${group.label} 小計`,
        rows: group.rows,
      });
    }
  }

  appendLevel(0, sorted, "root");
  return output;
}

export function QueryRuntimePage() {
  const { id } = useParams();
  const { accessToken } = useAuth();
  const queryId = Number(id);

  const [query, setQuery] = useState<Query | null>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [reportColumns, setReportColumns] = useState<ReportColumn[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const detail = await apiRequest<{
        query: Query;
        parameters: Parameter[];
        reportColumns: ReportColumn[];
      }>(`/queries/${queryId}`, {}, accessToken);

      setQuery(detail.query);
      setParameters(detail.parameters);
      setReportColumns(detail.reportColumns);

      const initialValues: Record<string, unknown> = {};
      for (const parameter of detail.parameters) {
        if (parameter.controlType === "MULTISELECT") initialValues[parameter.name] = [];
        else if (parameter.controlType === "CHECKBOX") initialValues[parameter.name] = parameter.defaultValue === "true";
        else initialValues[parameter.name] = parameter.defaultValue ?? "";
      }
      setValues(initialValues);

      const optionParameters = detail.parameters.filter((parameter) =>
        ["SELECT","MULTISELECT"].includes(parameter.controlType) && parameter.optionMode !== "NONE"
      );

      const loadedOptions = await Promise.all(optionParameters.map(async (parameter) => {
        const response = await apiRequest<{ options: Option[] }>(
          `/queries/${queryId}/parameters/${parameter.name}/options`,
          {},
          accessToken,
        );
        return [parameter.name, response.options] as const;
      }));

      setOptions(Object.fromEntries(loadedOptions));
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入查詢失敗。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, queryId]);

  useEffect(() => { if (Number.isFinite(queryId)) void load(); }, [load, queryId]);

  const visibleColumns = useMemo(() => {
    if (!result) return [];

    const resultNames = new Set(result.columns.map((column) => column.name));
    const configured = reportColumns
      .filter((column) => column.isVisible && resultNames.has(column.columnName))
      .sort((a, b) => a.displayOrder - b.displayOrder);

    if (configured.length > 0) return configured;

    return result.columns.map((column, index) => ({
      columnName: column.name,
      dataType: column.dataType ?? null,
      displayLabel: column.name,
      displayOrder: index,
      isVisible: true,
      width: null,
      displayFormat: null,
      alignment: "LEFT" as const,
      groupOrder: null,
      aggregateType: "NONE" as const,
    }));
  }, [reportColumns, result]);

  const hasAggregates = visibleColumns.some((column) => column.aggregateType !== "NONE");

  const groupColumns = useMemo(
    () => visibleColumns
      .filter((column) => column.groupOrder !== null)
      .sort((a, b) =>
        (a.groupOrder ?? Number.MAX_SAFE_INTEGER) - (b.groupOrder ?? Number.MAX_SAFE_INTEGER)
        || a.displayOrder - b.displayOrder
      ),
    [visibleColumns],
  );

  const groupedRows = useMemo(
    () => result ? buildGroupedRows(result.rows, groupColumns) : [],
    [result, groupColumns],
  );

  async function downloadExport(format: "excel" | "csv") {
    if (!query?.canExport) return;

    setError("");
    try {
      const download = await apiDownload(
        `/queries/${queryId}/export/${format}`,
        { values },
        accessToken,
      );

      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = download.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const fallback = format === "excel" ? "Excel 匯出失敗。" : "CSV 匯出失敗。";
      setError(e instanceof Error ? e.message : fallback);
    }
  }

  async function execute(event: FormEvent) {
    event.preventDefault();
    if (!query?.canExecute) return;

    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await apiRequest<{ result: QueryResult }>(
        `/queries/${queryId}/execute`,
        {
          method: "POST",
          body: JSON.stringify({ values }),
        },
        accessToken,
      );
      setResult(response.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "執行查詢失敗。");
    } finally {
      setRunning(false);
    }
  }

  function renderControl(parameter: Parameter) {
    const value = values[parameter.name];

    if (parameter.controlType === "CHECKBOX") {
      return (
        <input type="checkbox" checked={Boolean(value)}
          onChange={(e) => setValues({ ...values, [parameter.name]: e.target.checked })} />
      );
    }

    if (parameter.controlType === "SELECT") {
      return (
        <select value={String(value ?? "")}
          onChange={(e) => setValues({ ...values, [parameter.name]: e.target.value })}>
          <option value="">請選擇</option>
          {(options[parameter.name] ?? []).map((option, index) => (
            <option key={index} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
      );
    }

    if (parameter.controlType === "MULTISELECT") {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <select multiple value={selected}
          onChange={(e) => setValues({
            ...values,
            [parameter.name]: Array.from(e.target.selectedOptions, (option) => option.value),
          })}>
          {(options[parameter.name] ?? []).map((option, index) => (
            <option key={index} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
      );
    }

    const type =
      parameter.controlType === "NUMBER" ? "number" :
      parameter.controlType === "DATE" ? "date" :
      parameter.controlType === "DATETIME" ? "datetime-local" :
      "text";

    return (
      <input
        type={type}
        value={String(value ?? "")}
        placeholder={parameter.placeholder ?? ""}
        onChange={(e) => setValues({ ...values, [parameter.name]: e.target.value })}
      />
    );
  }

  if (loading) return <main className="page-shell"><section className="notice">載入中…</section></main>;

  return (
    <main className="page-shell runtime-page">
      <div className="page-toolbar">
        <div>
          <p className="eyebrow">{query?.category || "Query"}</p>
          <h1>{query?.name || "資料查詢"}</h1>
          {query?.description && <p className="subtitle">{query.description}</p>}
        </div>
        <Link className="secondary-button link-button" to="/queries">返回查詢功能</Link>
      </div>

      {error && <section className="form-error">{error}</section>}

      <form className="runtime-filter-card" onSubmit={execute}>
        <div className="runtime-parameter-grid">
          {parameters.map((parameter) => (
            <label key={parameter.name} className={parameter.controlType === "CHECKBOX" ? "checkbox-parameter" : ""}>
              <span>{parameter.label}{parameter.isRequired && <b> *</b>}</span>
              {renderControl(parameter)}
              {parameter.helpText && <small>{parameter.helpText}</small>}
            </label>
          ))}
        </div>

        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={running || !query?.canExecute}>
            {running ? "查詢中…" : "查詢"}
          </button>
          <button className="secondary-button" type="button" onClick={() => {
            setValues(Object.fromEntries(parameters.map((parameter) => [
              parameter.name,
              parameter.controlType === "MULTISELECT" ? [] :
              parameter.controlType === "CHECKBOX" ? false :
              parameter.defaultValue ?? "",
            ])));
            setResult(null);
          }}>清除</button>
        </div>
      </form>

      {result && (
        <section className="runtime-result">
          <div className="section-title">
            <div>
              <h2>查詢結果</h2>
              <p>{result.rowCount} 筆 · {result.elapsedMs} ms {result.truncated ? "· 已達筆數上限" : ""}</p>
            </div>
            {query?.canExport && (
              <div className="runtime-export-actions">
                <button className="secondary-button" type="button" onClick={() => void downloadExport("excel")}>匯出 Excel</button>
                <button className="secondary-button" type="button" onClick={() => void downloadExport("csv")}>匯出 CSV</button>
              </div>
            )}
          </div>

          <div className="runtime-table-wrap">
            <table>
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
                    <th key={column.columnName}
                      style={{
                        minWidth: column.width ? `${column.width}px` : undefined,
                        textAlign: column.alignment.toLowerCase() as "left" | "center" | "right",
                      }}>
                      {column.displayLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((item) => {
                  if (item.kind === "group") {
                    return (
                      <tr className={`runtime-group-row level-${item.level}`} key={item.key}>
                        <td colSpan={visibleColumns.length} style={{ paddingLeft: `${12 + item.level * 22}px` }}>
                          <strong>{item.label}</strong>
                          <span>{item.count} 筆</span>
                        </td>
                      </tr>
                    );
                  }

                  if (item.kind === "subtotal") {
                    return (
                      <tr className={`runtime-subtotal-row level-${item.level}`} key={item.key}>
                        {visibleColumns.map((column, index) => (
                          <td
                            key={column.columnName}
                            style={{
                              textAlign: column.alignment.toLowerCase() as "left" | "center" | "right",
                              paddingLeft: index === 0 ? `${12 + item.level * 22}px` : undefined,
                            }}
                          >
                            {index === 0 && column.aggregateType === "NONE"
                              ? item.label
                              : aggregateValue(column, item.rows)}
                          </td>
                        ))}
                      </tr>
                    );
                  }

                  return (
                    <tr key={item.key}>
                      {visibleColumns.map((column) => (
                        <td key={column.columnName}
                          style={{ textAlign: column.alignment.toLowerCase() as "left" | "center" | "right" }}>
                          {formatValue(item.row[column.columnName], column.displayFormat)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              {hasAggregates && (
                <tfoot>
                  <tr>
                    {visibleColumns.map((column, index) => (
                      <td key={column.columnName}
                        style={{ textAlign: column.alignment.toLowerCase() as "left" | "center" | "right" }}>
                        {index === 0 && column.aggregateType === "NONE"
                          ? "彙總"
                          : aggregateValue(column, result.rows)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
