/** Offline inventory validation. No DB driver, environment, process execution or SQL execution. */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => readFile(path.join(root, p), 'utf8');
const digest = s => createHash('sha256').update(s).digest('hex');
async function sqlFiles(dir) {
  const result = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await sqlFiles(p));
    else if (entry.name.endsWith('.sql')) result.push(p);
  }
  return result;
}
const doc = await read('docs/database-schema-inventory.md');
const pins = [...doc.matchAll(/^\| SOURCE \| ([^|]+) \| ([a-f0-9]{64}) \|$/gm)]
  .map(m => [m[1].trim(), m[2]]);
assert.equal(new Set(pins.map(([p]) => p)).size, pins.length, 'Duplicate source pins');
assert.deepEqual(pins.map(([p]) => p).filter(p => p.endsWith('.sql')).sort(), (await sqlFiles('.')).map(p => p.replace(/^\.\//, '')).sort(), 'SQL source coverage changed');
for (const [p, hash] of pins) assert.equal(digest(await read(p)), hash, `Source changed: ${p}`);
const migrations = JSON.parse(await read('database/acceptance/migration-inventory.json'));
const actual = (await readdir(path.join(root, 'database/migrations'))).filter(p => p.endsWith('.sql')).sort();
assert.deepEqual(actual, migrations.map(m => m.file).sort(), 'Historical migration source set changed');
for (const m of migrations) assert.equal(digest(await read(`database/migrations/${m.file}`)), m.sha256, `Migration modified: ${m.file}`);
assert.equal(actual.length, 49);
assert.ok(!actual.some(p => /^(922|923|924|925)_/.test(p)), 'Independent installer or nonexistent migration added to scanner');
const declarations = new Set();
for (const [p] of pins) {
  const text = await read(p);
  for (const m of text.matchAll(/CREATE\s+TABLE\s+\[?uqp\]?\.\[?(\w+)\]?\s*\(/gi)) declarations.add(m[1]);
}
const tables = [...doc.matchAll(/^### uqp\.(\w+)$/gm)].map(m => m[1]);
assert.deepEqual(tables.sort(), [...declarations].sort(), 'Table declaration coverage changed');
const sections = doc.split(/^### uqp\.\w+$/m).slice(1);
let columns = 0, constraints = 0, indexes = 0;
const statuses = { ACTIVE: 3, LEGACY_REQUIRED: 0, MIGRATION_ONLY: 0, UNUSED_CONFIRMED: 0, UNKNOWN: 0 }; // schema / trigger / sequence
for (const section of sections) {
  const status = section.match(/表級狀態：\*\*(\w+)\*\*/)?.[1];
  assert.ok(Object.hasOwn(statuses, status), 'Missing table classification');
  statuses[status]++;
  let kind;
  for (const line of section.split('\n')) {
    if (line.startsWith('| 欄位 |')) kind = 'COLUMN';
    else if (line.startsWith('| Constraint |')) kind = 'CONSTRAINT';
    else if (line.startsWith('| Index |')) kind = 'INDEX';
    else if (line.startsWith('## ')) kind = undefined;
    else if (line.startsWith('| ') && kind) {
      const cells = line.split('|').slice(1, -1).map(s => s.trim());
      const st = cells[kind === 'COLUMN' ? 3 : kind === 'CONSTRAINT' ? 2 : 1];
      assert.ok(Object.hasOwn(statuses, st), `Missing object classification: ${line}`);
      statuses[st]++;
      if (kind === 'COLUMN') columns++;
      if (kind === 'CONSTRAINT') constraints++;
      if (kind === 'INDEX') indexes++;
    }
  }
}
for (const [kind, count] of Object.entries({ SCHEMA: 1, TABLE: tables.length, COLUMN: columns, CONSTRAINT: constraints, INDEX: indexes, TRIGGER: 1, SEQUENCE: 1, ...statuses, TOTAL: Object.values(statuses).reduce((a, b) => a + b, 0) })) {
  assert.ok(doc.includes(`| ${kind} | ${count} |`), `Summary mismatch: ${kind} ${count}`);
}
console.log(JSON.stringify({ mode: 'OFFLINE_READ_ONLY', sqlSources: pins.length - 1, migrations: actual.length, schemas: 1, tables: tables.length, columns, constraints, indexes, statuses }));
