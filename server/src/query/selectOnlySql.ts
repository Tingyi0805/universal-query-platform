const forbiddenKeywords = [
  "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "TRUNCATE",
  "EXEC", "EXECUTE", "CREATE", "GRANT", "REVOKE", "DENY",
  "OPENROWSET", "OPENDATASOURCE",
];

function sanitizeForInspection(sqlText: string): string {
  return sqlText
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .trim();
}

export function assertSelectOnlySql(sqlText: string): void {
  const inspected = sanitizeForInspection(sqlText);
  if (!inspected) throw new Error("SQL_EMPTY");

  const withoutTrailingSemicolon = inspected.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    throw new Error("SQL_MULTIPLE_STATEMENTS_NOT_ALLOWED");
  }

  if (!/^(SELECT|WITH)\b/i.test(withoutTrailingSemicolon)) {
    throw new Error("SQL_SELECT_ONLY");
  }

  if (/\bSELECT\b[\s\S]*\bINTO\b/i.test(withoutTrailingSemicolon)) {
    throw new Error("SQL_SELECT_INTO_NOT_ALLOWED");
  }

  if (/\bFOR\s+UPDATE\b/i.test(withoutTrailingSemicolon)) {
    throw new Error("SQL_FOR_UPDATE_NOT_ALLOWED");
  }

  for (const keyword of forbiddenKeywords) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutTrailingSemicolon)) {
      throw new Error("SQL_FORBIDDEN_KEYWORD");
    }
  }
}
