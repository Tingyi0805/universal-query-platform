import oracledb from "oracledb";
import { env } from "../../../config/env.js";

let initialized = false;

export function ensureOracleClientInitialized() {
  if (initialized || env.ORACLE_DRIVER_MODE !== "THICK") return;

  if (env.ORACLE_CLIENT_LIB_DIR) {
    oracledb.initOracleClient({ libDir: env.ORACLE_CLIENT_LIB_DIR });
  } else {
    oracledb.initOracleClient();
  }

  initialized = true;
}


export function getOracleRuntimeDiagnostics() {
  const driverMode = oracledb.thin ? "THIN" : "THICK";
  let clientVersion: string | undefined;

  if (!oracledb.thin) {
    try {
      clientVersion = oracledb.oracleClientVersionString;
    } catch {
      clientVersion = undefined;
    }
  }

  return {
    driverName: "node-oracledb",
    driverVersion: oracledb.versionString,
    driverMode,
    clientVersion,
    configuredMode: env.ORACLE_DRIVER_MODE,
    clientLibDirConfigured: Boolean(env.ORACLE_CLIENT_LIB_DIR),
  };
}
