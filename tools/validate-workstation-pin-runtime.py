"""Offline additive-DDL and transaction contract checks, NOT SQL Server execution.
Requires sqlglot==28.0.0. The parser does not validate T-SQL control-flow semantics.
"""
from pathlib import Path
import re
import sqlglot
from sqlglot import exp


def validate(source):
    code = re.sub(r"--[^\n]*", "", source)
    if re.search(r"\b(DROP|TRUNCATE|MERGE|DELETE|BACKUP|RESTORE|USE)\b", code, re.I):
        raise ValueError("Destructive/out-of-scope SQL")
    if re.search(r"\b(UPDATE|INSERT\s+(?:INTO\s+)?)\s*(?:\[?uqp\]?\.)", code, re.I):
        raise ValueError("Application data write")
    if re.search(r"^\s*GO\s*$", code, re.M | re.I):
        raise ValueError("Keep transaction/variables in one runner batch")
    ddl = re.findall(r"(?:ALTER TABLE|CREATE TABLE|CREATE INDEX)\s+uqp\.[\s\S]*?;", code, re.I)
    # CREATE INDEX starts with its unqualified index name, so extract it separately.
    ddl += re.findall(r"CREATE INDEX\s+IX_PinAttempt_Updated\s+ON[\s\S]*?;", code, re.I)
    asts = [sqlglot.parse_one(s, read="tsql", error_level=sqlglot.ErrorLevel.RAISE) for s in ddl]
    if len(asts) != 3 or not all(isinstance(ast, (exp.Alter, exp.Create)) for ast in asts):
        raise ValueError("Expected only three additive DDL ASTs")
    targets = {(t.db, t.name) for ast in asts for t in ast.find_all(exp.Table)}
    if targets != {("uqp", "SharedWorkstation"), ("uqp", "WorkstationPinAttemptBucket")}:
        raise ValueError("DDL target changed")
    if re.search(r"\b(?:ALTER TABLE|CREATE TABLE|CREATE INDEX)\b", re.sub(r"(?:ALTER TABLE|CREATE TABLE|CREATE INDEX)[\s\S]*?;", "", code, flags=re.I), re.I):
        raise ValueError("Unexpected DDL")
    for contract in ["SAVE TRANSACTION WorkstationPinRuntimeSchema", "IF @ownsTransaction=1 COMMIT TRANSACTION",
                     "IF @ownsTransaction=1 AND XACT_STATE()<>0 ROLLBACK TRANSACTION",
                     "XACT_STATE()=1 ROLLBACK TRANSACTION WorkstationPinRuntimeSchema",
                     "PIN_SCHEMA_PARTIAL", "PIN_SCHEMA_BUCKET_COLUMNS_INVALID", "PIN_SCHEMA_CHECKS_INVALID",
                     "PIN_SCHEMA_DEFAULTS_INVALID", "PIN_SCHEMA_INDEXES_INVALID", "PIN_SCHEMA_KEYS_INVALID",
                     "PIN_SCHEMA_UNEXPECTED_FEATURE", "PIN_SCHEMA_NAME_CONFLICT"]:
        if contract not in code:
            raise ValueError("Missing fail-closed transaction/catalog contract")


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    source = (root / "database/migrations/927_workstation_pin_runtime.sql").read_text()
    draft = (root / "database/drafts/workstation_pin_runtime.forward.sql").read_text()
    if draft.split("\n", 1)[1] != source:
        raise ValueError("Review copy differs from numbered Migration")
    validate(source)
    for bad in [source + "\nDELETE FROM uqp.UserQuickPin;", source + "\nDROP TABLE uqp.AppUser;",
                source + "\nUPDATE uqp.SharedWorkstation SET PinLoginEnabled=1;",
                source.replace("SAVE TRANSACTION WorkstationPinRuntimeSchema", "SELECT 1")]:
        try:
            validate(bad)
        except ValueError:
            continue
        raise ValueError("Unsafe SQL accepted")
    print("PASS: three additive DDL ASTs, review-copy identity, static transaction/catalog guards, four rejection cases; SQL Server UNVERIFIED")
