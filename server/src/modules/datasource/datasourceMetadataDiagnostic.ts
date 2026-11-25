import { getDataSourceConfig } from "./datasource.repository.js";
import { createDataSourceAdapter } from "./adapters/adapterFactory.js";
import { QueryDescriptionError } from "../../query/queryDescription.js";
import type { DataSourceConfig } from "./datasource.types.js";
import type { CandidateQueryDescription, ColumnDescribeInput } from "../../query/queryDescription.js";

export type MetadataDiagnosticResult = Readonly<{
  ok: boolean;
  code: string;
  message: string;
  sourceType: string;
}>;

type DiagnosticAdapter = {
  describeQuery?: (config: DataSourceConfig, input: ColumnDescribeInput) => Promise<CandidateQueryDescription>;
};
type DiagnosticDependencies = Readonly<{
  config: (id: number) => Promise<DataSourceConfig | null>;
  adapter: (type: DataSourceConfig["type"]) => DiagnosticAdapter;
}>;
export const defaultMetadataDiagnosticDependencies: DiagnosticDependencies = {
  config: getDataSourceConfig,
  adapter: createDataSourceAdapter,
};

// Fixed messages only. Never return SQL Server/Oracle exception text, server
// addresses, schema/column data, credentials or customer SQL to the browser.
const failures: Readonly<Record<string, string>> = {
  DESCRIPTION_CONNECT_FAILED: "連線階段失敗：請先以相同資料來源測試連線與 TLS／Oracle Client 設定。",
  DESCRIPTION_INFERENCE_FAILED: "參數型別推導階段失敗；此固定查詢不應需要任何參數。",
  DESCRIPTION_RPC_FAILED: "SQL Server 欄位描述程序失敗；請核對來源資料庫版本及登入帳號的權限。",
  DESCRIPTION_CLEANUP_FAILED: "資料來源描述連線清理失敗。",
  DESCRIPTION_UNSUPPORTED: "資料來源或目前的 Oracle Thin／Thick 驅動組合不支援安全欄位描述。",
  DESCRIPTION_TIMEOUT: "安全欄位描述逾時，請檢查來源資料庫服務及網路。",
  DESCRIPTION_METADATA_INVALID: "資料來源傳回不完整的欄位描述，未執行資料列查詢。",
  DESCRIPTION_FAILED: "資料來源無法完成安全欄位描述，請依 Request ID 檢查伺服器日誌。",
};

export async function diagnoseSavedMetadata(
  id: number,
  deps: DiagnosticDependencies = defaultMetadataDiagnosticDependencies,
): Promise<MetadataDiagnosticResult> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("DATASOURCE_NOT_FOUND");
  const source = await deps.config(id);
  if (!source) throw new Error("DATASOURCE_NOT_FOUND");
  const sourceType = source.type;
  if (!source.isActive) {
    return {ok: false, code: "DATASOURCE_DISABLED", message: "資料來源已停用，無法進行欄位描述測試。", sourceType};
  }
  if (sourceType !== "SQLSERVER" && sourceType !== "ORACLE") {
    return {ok: false, code: "DESCRIPTION_UNSUPPORTED",
      message: "此診斷僅適用 SQL Server／Oracle；不會執行資料列查詢。", sourceType};
  }
  const sqlText = sourceType === "ORACLE"
    ? "SELECT 1 AS UQP_META_TEST FROM DUAL"
    : "SELECT 1 AS UQP_META_TEST";
  try {
    const describe = deps.adapter(sourceType).describeQuery;
    if (!describe) throw new QueryDescriptionError("DESCRIPTION_UNSUPPORTED");
    const result = await describe(source, {sql: sqlText, parameters: [], timeoutSec: 10});
    if (result.trust !== "UNBOUND_CANDIDATE" || !result.requiresExecutionComparison
      || result.columns.length !== 1 || result.columns[0]?.name !== "UQP_META_TEST"
      || !result.columns[0].dataType || result.columns[0].ordinal !== 1)
      throw new QueryDescriptionError("DESCRIPTION_METADATA_INVALID");
    return {ok: true, code: "DESCRIPTION_OK",
      message: "安全欄位描述成功：來源可取得固定測試欄位的名稱與型別，未執行資料列查詢。", sourceType};
  } catch (error) {
    const code = error instanceof QueryDescriptionError && Object.hasOwn(failures, error.code)
      ? error.code : "DESCRIPTION_FAILED";
    return {ok: false, code, message: failures[code]!, sourceType};
  }
}
