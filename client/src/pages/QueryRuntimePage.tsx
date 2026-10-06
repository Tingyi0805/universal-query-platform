import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../api/client";
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

type Option = { value: unknown; label: string };

type QueryResult = {
  columns: { name: string; dataType?: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

export function QueryRuntimePage() {
  const { id } = useParams();
  const { accessToken } = useAuth();
  const queryId = Number(id);

  const [query, setQuery] = useState<Query | null>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);
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
      const detail = await apiRequest<{ query: Query; parameters: Parameter[] }>(
        `/queries/${queryId}`,
        {},
        accessToken,
      );

      setQuery(detail.query);
      setParameters(detail.parameters);

      const initialValues: Record<string, unknown> = {};
      for (const parameter of detail.parameters) {
        if (parameter.controlType === "MULTISELECT") {
          initialValues[parameter.name] = [];
        } else if (parameter.controlType === "CHECKBOX") {
          initialValues[parameter.name] = parameter.defaultValue === "true";
        } else {
          initialValues[parameter.name] = parameter.defaultValue ?? "";
        }
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
            {query?.canExport && <button className="secondary-button" type="button" disabled>Excel（下一階段）</button>}
          </div>

          <div className="runtime-table-wrap">
            <table>
              <thead>
                <tr>
                  {result.columns.map((column) => <th key={column.name}>{column.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index}>
                    {result.columns.map((column) => (
                      <td key={column.name}>{row[column.name] == null ? "" : String(row[column.name])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
