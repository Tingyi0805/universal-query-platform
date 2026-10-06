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
