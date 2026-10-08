export type DatasetRecord = {
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
  isArchived: boolean;
  archivedAtUtc: string | null;
  archivedByUserId: number | null;
  parameterNames: string[];
};

export type DatasetInput = {
  code: string;
  name: string;
  description: string | null;
  dataSourceId: number;
  sqlText: string;
  maxRows: number;
  queryTimeoutSec: number | null;
  isActive: boolean;
};
