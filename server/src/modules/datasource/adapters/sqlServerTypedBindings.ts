import sql from "mssql";
import { readSqlServerTypedBindPlan, TypedBindPlanError, type SqlServerTypedBindPlan } from "../../../query/sqlServerTypedBindPlan.js";
import type { DescriptionParameterType } from "../../../query/queryDescription.js";

export type TypedBindRequest = {
  parameters: Record<string, unknown>;
  parent?: { config?: { options?: { useUTC?: boolean } } };
  input(name: string, type: unknown, value: unknown): unknown;
};
function requestType(type: DescriptionParameterType) {
  switch (type.type) {
    case "INT": return sql.Int;
    case "BIGINT": return sql.BigInt;
    case "BIT": return sql.Bit;
    case "FLOAT": return sql.Float;
    case "DECIMAL": return sql.Decimal(type.precision, type.scale);
    case "DATE": return sql.Date;
    // Never let a null DateTime2 parameter default its scale to zero.
    case "DATETIME2": return sql.DateTime2(7);
    case "NVARCHAR": return sql.NVarChar(type.length === "MAX" ? sql.MAX : type.length);
    case "VARCHAR": return sql.VarChar(type.length === "MAX" ? sql.MAX : type.length);
    case "VARBINARY": return sql.VarBinary(type.length === "MAX" ? sql.MAX : type.length);
  }
}
function requireEmptyRequest(request: TypedBindRequest): void {
  if (!request || typeof request.input !== "function" || !request.parameters
    || ![Object.prototype, null].includes(Object.getPrototypeOf(request.parameters))
    || Reflect.ownKeys(request.parameters).length !== 0) throw new TypedBindPlanError("TYPED_BIND_REQUEST_INVALID");
}

// These helpers only prepare local Request objects. They do not connect, call
// execute/query, perform audit or authorize delivery. Discard Request on failure.
export function prepareSqlServerTypedDescription(plan: SqlServerTypedBindPlan, request: TypedBindRequest) {
  const data = readSqlServerTypedBindPlan(plan);
  try {
    requireEmptyRequest(request);
    request.input("tsql", sql.NVarChar(sql.MAX), data.sql);
    request.input("params", sql.NVarChar(sql.MAX), data.parameterDeclaration);
    request.input("browse_information_mode", sql.TinyInt, 0);
    return Object.freeze({ procedure: "sys.sp_describe_first_result_set" as const });
  } catch (error) {
    if (error instanceof TypedBindPlanError) throw error;
    throw new TypedBindPlanError("TYPED_BIND_REQUEST_FAILED");
  }
}

export function prepareSqlServerTypedRuntime(plan: SqlServerTypedBindPlan, request: TypedBindRequest) {
  const data = readSqlServerTypedBindPlan(plan);
  try {
    requireEmptyRequest(request);
    if (data.binds.some(bind => ["DATE", "DATETIME2"].includes(bind.nativeType.type))
      && request.parent?.config?.options?.useUTC !== true) throw new TypedBindPlanError("TYPED_BIND_UTC_REQUIRED");
    for (const bind of data.binds) request.input(bind.name, requestType(bind.nativeType), bind.value);
    return Object.freeze({ sql: data.sql });
  } catch (error) {
    if (error instanceof TypedBindPlanError) throw error;
    throw new TypedBindPlanError("TYPED_BIND_REQUEST_FAILED");
  }
}
