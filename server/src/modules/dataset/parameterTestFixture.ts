// Isolated synthetic fixture: never obtains a real pool or driver connection.
import sql from "mssql";
import { createParameterRepository, type DatasetParameterRecord } from "./parameter.repository.js";
export const syntheticParameter: DatasetParameterRecord = {
  id: 10, datasetId: 2, name: "WARD", label: "測試病區", dataType: "DATE", controlType: "DATE", isRequired: true,
  defaultValue: "$TODAY-7", dateOutputMode: "STRING", dateCalendar: "ROC", dateFormat: "yyyMMdd", displayOrder: 7,
  placeholder: "測試", helpText: "synthetic", optionMode: "FIXED", fixedOptionsJson: '[{"value":"TEST","label":"測試"}]',
  lookupDatasetId: null, lookupValueField: null, lookupLabelField: null,
};
export function rawParameter(p: DatasetParameterRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p).map(([key, value]) => [key[0]!.toUpperCase() + key.slice(1), value]));
}
export function parameterFixture(sqlText = "SELECT {{WARD}}, {{NEW}}", rows = [rawParameter(syntheticParameter)]) {
  const state = { sqlText, rows: structuredClone(rows), staged: structuredClone(rows), archived: false,
    queries: [] as string[], transactions: 0, commits: 0, rollbacks: 0, snapshots: 0, failOn: "", failRollback: false };
  function request(transaction = false) {
    const values: Record<string, unknown> = {};
    const r = {
      input: (name: string, _type: unknown, value: unknown) => { values[name] = value; return r; },
      query: async (text: string) => {
        state.queries.push(text);
        if (state.failOn && text.includes(state.failOn)) throw Object.assign(new Error("synthetic secret SQL bind password"), { code: "EREQUEST", number: 229 });
        const data = transaction ? state.staged : state.rows;
        if (/^\s*SELECT/.test(text)) {
          if (text.includes("uqp.DatasetParameter")) return { recordset: structuredClone(data) };
          return { recordset: [{ Id: 2, SqlText: state.sqlText, IsArchived: state.archived }] };
        }
        if (!transaction) throw new Error("WRITE_OUTSIDE_TRANSACTION");
        if (text.includes("INSERT INTO uqp.DatasetParameter")) data.push(rawParameter({ ...syntheticParameter,
          id: 99 + data.length, name: String(values.name), label: String(values.name), displayOrder: Number(values.displayOrder) }));
        if (text.includes("DELETE FROM uqp.DatasetParameter")) state.staged = data.filter(row => row.Name !== values.name);
        if (text.includes("UPDATE uqp.DatasetParameter")) {
          const row = data.find(row => row.Name === values.name)!;
          for (const [key, value] of Object.entries(values)) if (!["datasetId", "name"].includes(key)) row[key[0]!.toUpperCase() + key.slice(1)] = value;
        }
        return { recordset: [] };
      },
    };
    return r as unknown as sql.Request;
  }
  const tx = {
    begin: async (level: number) => {
      if (level !== sql.ISOLATION_LEVEL.SERIALIZABLE) throw new Error("UNSAFE_ISOLATION");
      state.transactions++; state.staged = structuredClone(state.rows);
    },
    commit: async () => { state.commits++; state.rows = structuredClone(state.staged); },
    rollback: async () => { state.rollbacks++; if (state.failRollback) throw new Error("rollback failed"); state.staged = structuredClone(state.rows); },
  } as unknown as sql.Transaction;
  const repository = createParameterRepository({ getPool: async () => ({ request: () => request() }) as unknown as sql.ConnectionPool,
    createTransaction: () => tx, createRequest: () => request(true), snapshotVersion: async () => { state.snapshots++; return 1; } });
  return { state, repository };
}
