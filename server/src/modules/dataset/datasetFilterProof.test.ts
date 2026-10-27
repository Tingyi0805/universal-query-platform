import assert from "node:assert/strict";
import test from "node:test";
import { proveDatasetFilterChange } from "./datasetFilterProof.js";
const base = 'SELECT A.PATIENT_NAME AS "姓名", A.MRN AS "病歷號" FROM SYNTHETIC_OPERATIONS A';
const range = 'A.APP_DATE BETWEEN {{S_DATE}} AND {{EXAM_DATE}}';
for (const [name, before, after] of [
  ["OR_001-shaped BETWEEN", base, `${base} WHERE ${range}`],
  ["tenant restriction", `${base} WHERE A.TENANT_ID = {{TENANT}}`, `${base} WHERE A.TENANT_ID = {{TENANT}} AND ${range}`],
  ["parenthesized OR", `${base} WHERE A.STATUS = 'A' OR A.STATUS = 'B'`, `${base} WHERE (A.STATUS = 'A' OR A.STATUS = 'B') AND ${range}`],
  ["grouped AND", `${base} WHERE A.X = 1 AND A.Y = 2`, `${base} WHERE (A.X = 1 AND A.Y = 2) AND (${range})`],
  ["ordering", `${base} ORDER BY A.APP_DATE DESC`, `${base} WHERE ${range} ORDER BY A.APP_DATE DESC`],
  ...["INNER", "LEFT", "RIGHT", "FULL"].map(kind => [kind + " JOIN", `${base} ${kind} JOIN T B ON A.ID = B.ID`, `${base} ${kind} JOIN T B ON A.ID = B.ID WHERE ${range}`]),
  ["legacy join retained", `${base}, T B WHERE A.ID = B.ID`, `${base}, T B WHERE A.ID = B.ID AND ${range}`],
  ["escaped literals", base, `${base} WHERE A.STATUS IN ('WHERE', 'A''B') AND A.MRN IS NOT NULL`],
  ["numeric bounds", base, `${base} WHERE A.AGE BETWEEN -10 AND +99`],
  ["NOT LIKE", base, `${base} WHERE NOT (A.STATUS LIKE 'X%' OR A.STATUS = 'Y')`],
] as [string, string, string][]) test(`allows ${name}`, () => assert.equal(proveDatasetFilterChange(before, after, ["姓名", "病歷號"])?.kind, "ROW_FILTER_REFINEMENT"));

test("allows bracketed identifiers", () => assert.ok(proveDatasetFilterChange(
  'SELECT [A].[Name] AS [NAME] FROM [dbo].[Synthetic] AS [A]',
  'SELECT [A].[Name] AS [NAME] FROM [dbo].[Synthetic] AS [A] WHERE [A].[AppDate] BETWEEN {{S_DATE}} AND {{EXAM_DATE}}', ["NAME"])));

const changedProjections = [
  base.replace('A.PATIENT_NAME', 'A.SECRET_TEXT'), base.replace('A.PATIENT_NAME', 'A.PATIENT_NAME + A.SECRET_TEXT'),
  base.replace('SYNTHETIC_OPERATIONS', 'SYNTHETIC_SECRETS'), base.replace('A.PATIENT_NAME', 'SECRET_FN(A.MRN)'),
  'SELECT A.* FROM T A', 'SELECT MAX(A.MRN) AS MRN FROM T A',
  'SELECT ROW_NUMBER() OVER (ORDER BY A.ID) AS RN FROM T A', 'SELECT (SELECT X FROM T) AS MRN FROM T A',
  'WITH C AS (SELECT X FROM T) SELECT C.X FROM C', 'SELECT A.X FROM (SELECT X FROM T) A',
  'SELECT TOP 10 A.MRN FROM T A', 'SELECT DISTINCT A.MRN FROM T A', 'SELECT ROWNUM AS RN FROM T A',
  'SELECT A.X AS NAME, A.Y AS name FROM T A',
];
for (const [index, sql] of changedProjections.entries()) test(`refuses projection/source ${sql}`, () => {
  assert.equal(proveDatasetFilterChange(base, `${sql} WHERE ${range}`, []), null);
  if (![0, 2].includes(index)) assert.equal(proveDatasetFilterChange(sql, `${sql} WHERE ${range}`, []), null);
});
for (const [name, before, after] of [
  ["JOIN ON", `${base} JOIN T B ON A.ID = B.ID`, `${base} JOIN T B ON A.MRN = B.ID WHERE ${range}`],
  ["JOIN kind", `${base} LEFT JOIN T B ON A.ID = B.ID`, `${base} JOIN T B ON A.ID = B.ID WHERE ${range}`],
  ["added JOIN", base, `${base} JOIN T B ON A.ID = B.ID WHERE ${range}`],
  ["new legacy join predicate", `${base}, T B`, `${base}, T B WHERE A.ID = B.ID`],
  ["removed restriction", `${base} WHERE A.TENANT_ID = {{TENANT}}`, `${base} WHERE ${range}`],
  ["OR broadening", `${base} WHERE A.TENANT_ID = {{TENANT}}`, `${base} WHERE A.TENANT_ID = {{TENANT}} OR ${range}`],
  ["OR precedence", `${base} WHERE A.X = 1 OR A.Y = 2`, `${base} WHERE A.X = 1 OR A.Y = 2 AND ${range}`],
  ["restriction value", `${base} WHERE A.X = 1`, `${base} WHERE A.X = 2 AND ${range}`],
  ["ordering", `${base} ORDER BY A.MRN`, `${base} WHERE ${range} ORDER BY A.APP_DATE`],
  ...[`${range} UNION SELECT SECRET, MRN FROM T`, 'A.MRN IN (SELECT SECRET FROM T)', 'SECRET_FN(A.MRN) = 1',
    `${range} LIMIT 1`, `${range} GROUP BY A.MRN`, 'ROWNUM < 10', 'X.APP_DATE = {{EXAM_DATE}}',
    `${range}; SELECT SECRET FROM T`, `${range} -- AND A.X=1`, 'A.APP_DATE = {{broken}}', 'A.APP_DATE = :EXAM_DATE',
    "A.STATUS = q'[text]'", `(${range}`, 'APP_DATE = {{EXAM_DATE}}', `${'('.repeat(40)}${range}${')'.repeat(40)}`,
  ].map(predicate => [predicate, base, `${base} WHERE ${predicate}`]),
  ["hint", base, base.replace('SELECT', 'SELECT /*+ HINT */') + ` WHERE ${range}`],
  ["DML", base, 'UPDATE T SET X=1'],
] as [string, string, string][]) test(`refuses ${name}`, () => assert.equal(proveDatasetFilterChange(before, after, []), null));
test("stale policy column cannot be proved from an alias", () => {
  assert.equal(proveDatasetFilterChange(base, `${base} WHERE ${range}`, ["PATIENT_NAME"]), null);
});

test("bounded nested boolean proof does not expand subtree encodings", () => {
  assert.ok(proveDatasetFilterChange(base, `${base} WHERE ${"NOT ".repeat(24)}(${range})`, []));
  assert.equal(proveDatasetFilterChange(base, `${base} WHERE ${"NOT ".repeat(40)}(${range})`, []), null);
});
