"""Offline only. Requires sqlglot==28.0.0; never imports a database driver."""
from pathlib import Path
import re

import sqlglot
from sqlglot import exp


def is_catalog_read(ast):
    return (
        isinstance(ast, exp.Select)
        and not list(ast.find_all(exp.Into))
        and not list(ast.find_all(exp.Star))
        and all(table.db == "sys" for table in ast.find_all(exp.Table))
        and not any(isinstance(node, (exp.Command, exp.Insert, exp.Update,
                                     exp.Delete, exp.Create, exp.Drop,
                                     exp.Alter, exp.Merge)) for node in ast.walk())
    )


def main():
    root = Path(__file__).resolve().parent.parent
    source = (root / "database/acceptance/production-workstation-pin-readonly.sql").read_text()
    statements = []
    for batch in re.split(r"^GO\s*$", source, flags=re.M):
        if re.sub(r"--[^\n]*", "", batch).strip():
            statements.extend(sqlglot.parse(batch, read="tsql", error_level=sqlglot.ErrorLevel.RAISE))
    if len(statements) != 7 or not all(is_catalog_read(ast) for ast in statements):
        raise ValueError("Expected seven catalog-only SELECT statements without INTO or star")
    # Guard against false positives in this check, not just the current script.
    for unsafe in ("DELETE FROM uqp.UserQuickPin", "SELECT 1 INTO uqp.X",
                   "EXEC(N'SELECT 1')", "SELECT * FROM uqp.UserQuickPin",
                   "SELECT PinHash FROM uqp.UserQuickPin"):
        if is_catalog_read(sqlglot.parse_one(unsafe, read="tsql")):
            raise ValueError("Unsafe SQL was accepted")
    print("PASS: 7 catalog SELECT ASTs; 5 unsafe SQL rejection cases")


if __name__ == "__main__":
    main()
