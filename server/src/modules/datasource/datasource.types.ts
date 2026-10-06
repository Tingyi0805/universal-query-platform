export type DataSourceType = "SQLSERVER" | "ORACLE" | "MYSQL" | "POSTGRESQL";
export type OracleConnectionMode = "SERVICE_NAME" | "SID";

export type DataSourceConfig = {
  id?: number;
  code: string;
  name: string;
  type: DataSourceType;
  host: string;
  port: number;
  databaseName: string | null;
  oracleServiceName: string | null;
  oracleConnectionMode: OracleConnectionMode | null;
  username: string;
  password: string;
  connectionTimeoutSec: number;
  queryTimeoutSec: number;
  encryptConnection: boolean;
  trustServerCertificate: boolean;
  isActive: boolean;
};

export type DataSourceListItem = Omit<DataSourceConfig, "password"> & {
  hasPassword: boolean;
};

export type ConnectionCompatibilityStatus =
  | "VERIFIED"
  | "NEEDS_CONFIGURATION"
  | "UNSUPPORTED"
  | "UNKNOWN";

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  serverVersion?: string;
  driverName?: string;
  driverVersion?: string;
  driverMode?: string;
  clientVersion?: string;
  compatibilityStatus?: ConnectionCompatibilityStatus;
  errorCode?: string;
  recommendation?: string;
};
