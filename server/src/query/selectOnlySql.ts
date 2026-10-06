const forbiddenKeywords = [
  "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "TRUNCATE",
  "EXEC", "EXECUTE", "CREATE", "GRANT", "REVOKE", "DENY",
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

  const upper = withoutTrailingSemicolon.toUpperCase();
  if (!(upper.startsWith("SELECT ") || upper.startsWith("SELECT\n") || upper.startsWith("WITH ") || upper.startsWith("WITH\n"))) {
    throw new Error("SQL_SELECT_ONLY");
  }

  for (const keyword of forbiddenKeywords) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutTrailingSemicolon)) {
      throw new Error("SQL_FORBIDDEN_KEYWORD");
    }
  }
}
