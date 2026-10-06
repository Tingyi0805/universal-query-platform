import { createDataSourceAdapter } from "./adapters/adapterFactory.js";
import { getOracleRuntimeDiagnostics } from "./adapters/oracleClient.js";
import { getDataSourceConfig } from "./datasource.repository.js";
import type { ConnectionTestResult, DataSourceConfig } from "./datasource.types.js";

function extractErrorCode(message: string): string | undefined {
  const match = message.match(/\b(NJS-\d+|DPI-\d+|ORA-\d+)\b/i);
  return match?.[1]?.toUpperCase();
}

function extractOdbcSqlState(message: string): string | undefined {
  const bracketed = message.match(/\[([A-Z0-9]{5})\]/i);
  if (bracketed?.[1]) return bracketed[1].toUpperCase();

  const labeled = message.match(/SQLSTATE[^A-Z0-9]*([A-Z0-9]{5})/i);
  return labeled?.[1]?.toUpperCase();
}

function diagnoseOdbcFailure(message: string, config: DataSourceConfig): ConnectionTestResult {
  const errorCode = extractOdbcSqlState(message);

  if (errorCode === "IM002") {
    return {
      ok: false,
      message: "ODBC 連線失敗：找不到指定的 DSN 或預設 Driver。",
      driverName: "ODBC",
      driverMode: config.odbcConnectionMode ?? undefined,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation:
        "請確認 ODBC Driver 已安裝，DSN 名稱完全一致；Windows 請同時確認 Node.js 與 ODBC Driver 使用相同位元數（通常為 64-bit）。",
    };
  }

  if (errorCode === "IM003") {
    return {
      ok: false,
      message: "ODBC 連線失敗：指定的 ODBC Driver 無法載入。",
      driverName: "ODBC",
      driverMode: config.odbcConnectionMode ?? undefined,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation: "請確認 ODBC Driver 已正確安裝、Driver 名稱正確，並確認 Node.js 與 Driver 位元數一致。",
    };
  }

  if (errorCode === "28000") {
    return {
      ok: false,
      message: "ODBC 連線失敗：資料庫驗證失敗。",
      driverName: "ODBC",
      driverMode: config.odbcConnectionMode ?? undefined,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation: "請確認帳號、密碼及該 DSN／Connection String 所使用的驗證方式。",
    };
  }

  if (errorCode === "08001" || errorCode === "08004") {
    return {
      ok: false,
      message: "ODBC 連線失敗：無法建立資料庫連線或 Server 拒絕連線。",
      driverName: "ODBC",
      driverMode: config.odbcConnectionMode ?? undefined,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation: "請確認 Server、Port、Database/Service、Firewall、ODBC Driver 與 Connection String 設定。",
    };
  }

  if (errorCode === "HYT00" || errorCode === "HYT01") {
    return {
      ok: false,
      message: "ODBC 連線失敗：連線或登入逾時。",
      driverName: "ODBC",
      driverMode: config.odbcConnectionMode ?? undefined,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation: "請確認網路與資料庫服務正常，必要時再調整 Connection Timeout。",
    };
  }

  return {
    ok: false,
    message: `ODBC 連線失敗：${message}`,
    driverName: "ODBC",
    driverMode: config.odbcConnectionMode ?? undefined,
    compatibilityStatus: "UNKNOWN",
    errorCode,
    recommendation: "請確認 ODBC Driver、DSN／Connection String、帳號驗證、Driver 位元數與目標資料庫網路設定。",
  };
}

function diagnoseOracleFailure(message: string): ConnectionTestResult {
  const runtime = getOracleRuntimeDiagnostics();
  const errorCode = extractErrorCode(message);

  if (errorCode === "NJS-138") {
    return {
      ok: false,
      message: "Oracle 連線失敗：目前使用 Thin Mode，但目標 Oracle Database 版本不支援此連線模式。",
      driverName: runtime.driverName,
      driverVersion: runtime.driverVersion,
      driverMode: runtime.driverMode,
      configuredDriverMode: runtime.configuredMode,
      clientVersion: runtime.clientVersion,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation:
        "請將 ORACLE_DRIVER_MODE 設為 THICK，確認 ORACLE_CLIENT_LIB_DIR 指向可用的 Oracle Instant Client 目錄，再重新啟動後端服務後測試。",
    };
  }

  if (errorCode === "DPI-1047") {
    return {
      ok: false,
      message: "Oracle 連線失敗：Thick Mode 無法載入 Oracle Client 程式庫。",
      driverName: runtime.driverName,
      driverVersion: runtime.driverVersion,
      driverMode: runtime.driverMode,
      configuredDriverMode: runtime.configuredMode,
      clientVersion: runtime.clientVersion,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation:
        "請檢查 ORACLE_CLIENT_LIB_DIR 是否指向正確的 Instant Client 目錄、Node.js 與 Oracle Client 位元數是否一致，然後重新啟動後端。",
    };
  }

  if (errorCode === "ORA-12514") {
    return {
      ok: false,
      message: "Oracle 連線失敗：Listener 找不到指定的 Service Name。",
      driverName: runtime.driverName,
      driverVersion: runtime.driverVersion,
      driverMode: runtime.driverMode,
      configuredDriverMode: runtime.configuredMode,
      clientVersion: runtime.clientVersion,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation: "請確認 Service Name、Host、Port 與 Listener 設定是否正確；若使用 SID，請將連線模式切換為 SID。",
    };
  }

  if (errorCode === "ORA-01017") {
    return {
      ok: false,
      message: "Oracle 連線失敗：帳號或密碼不正確。",
      driverName: runtime.driverName,
      driverVersion: runtime.driverVersion,
      driverMode: runtime.driverMode,
      configuredDriverMode: runtime.configuredMode,
      clientVersion: runtime.clientVersion,
      compatibilityStatus: "NEEDS_CONFIGURATION",
      errorCode,
      recommendation: "請確認 Oracle Username / Password，並確認帳號未被鎖定且具有登入權限。",
    };
  }

  return {
    ok: false,
    message: `Oracle 連線失敗：${message}`,
    driverName: runtime.driverName,
    driverVersion: runtime.driverVersion,
    driverMode: runtime.driverMode,
    clientVersion: runtime.clientVersion,
    compatibilityStatus: "UNKNOWN",
    errorCode,
    recommendation: "請依錯誤碼檢查 Oracle 網路、Listener、帳號、Service/SID 與 Client 相容性設定。",
  };
}

export async function testDataSourceConfig(config: DataSourceConfig): Promise<ConnectionTestResult> {
  try {
    return await createDataSourceAdapter(config.type).testConnection(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知錯誤";

    if (config.type === "ORACLE") {
      return diagnoseOracleFailure(message);
    }

    if (config.type === "ODBC") {
      return diagnoseOdbcFailure(message, config);
    }

    return {
      ok: false,
      message: `連線失敗：${message}`,
      compatibilityStatus: "UNKNOWN",
      errorCode: extractErrorCode(message),
    };
  }
}

export async function testSavedDataSource(id: number): Promise<ConnectionTestResult> {
  const config = await getDataSourceConfig(id);
  if (!config) throw new Error("DATASOURCE_NOT_FOUND");
  return testDataSourceConfig(config);
}
