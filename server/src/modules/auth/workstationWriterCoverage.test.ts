import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import type sql from "mssql";
import { workstationProtectedSqlSources } from "./workstationRevocationWriterInventory.js";
import { withLegacyWorkstationTransaction } from "./workstationLegacyTransaction.js";
import { legacyWorkstationWriterFenceSql } from "./workstationLegacyWriterFence.js";
import { createWorkstationSessionSqlRepository } from "./workstationSessionSql.repository.js";
import { createWorkstationOperatorSqlRepository } from "./workstationOperatorSql.repository.js";
const root = new URL("../../../../", import.meta.url);
const protectedDml = /\b(?:UPDATE|INSERT(?:\s+INTO)?|DELETE(?:\s+FROM)?|MERGE(?:\s+INTO)?)\s+uqp\.(?:AppUser|Role|Permission|UserRole|RolePermission|SharedWorkstation\w*|UserQuickPin\w*|QuickPinPolicy)\b|\bUPDATE\s+u\s+SET\s+TokenVersion\s*=/i;

test("source scan detects unclassified protected SQL writer files", () => {
  const found = new Set<string>();
  function walk(dir: URL) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(item.name + (item.isDirectory() ? "/" : ""), dir);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith(".ts") && !item.name.endsWith(".test.ts")) {
        if (protectedDml.test(readFileSync(path, "utf8"))) found.add(path.href.slice(root.href.length));
      }
    }
  }
  walk(new URL("server/src/modules/", root));
  assert.deepEqual([...found].sort(), [...workstationProtectedSqlSources].sort());
});
test("unwired Session/Operator adapters cannot obtain the shared platform pool by default", async () => {
  for (const adapter of [createWorkstationSessionSqlRepository(), createWorkstationOperatorSqlRepository()]) {
    await assert.rejects(adapter.repository.transaction(async () => assert.fail("must not enter business work")),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "DATABASE_UNAVAILABLE");
    assert.equal(adapter.runtimeEnabled, false);
  }
});
test("every identity SQL mutation is structurally inside the common owner callback", () => {
  for (const path of ["server/src/modules/admin/admin.repository.ts", "server/src/modules/auth/auth.repository.ts"]) {
    const source = ts.createSourceFile(path, readFileSync(new URL(path, root), "utf8"), ts.ScriptTarget.Latest, true);
    let mutations = 0;
    function visit(node: ts.Node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
          protectedDml.test(node.getText(source))) {
        mutations++;
        let ancestor = node.parent, owned = false;
        while (ancestor) {
          if (ts.isCallExpression(ancestor) && ancestor.expression.getText(source) === "withLegacyWorkstationTransaction") owned = true;
          ancestor = ancestor.parent;
        }
        assert.ok(owned, path + ": identity DML outside owner");
      }
      ts.forEachChild(node, visit);
    }
    visit(source); assert.ok(mutations > 0);
  }
});
test("synthetic shared gate serializes distinct legacy callbacks before business work", async () => {
  const events: string[] = [];
  let tail = Promise.resolve(), releaseFirst!: () => void, entered!: () => void;
  const hold = new Promise<void>(resolve => { releaseFirst = resolve; });
  const firstEntered = new Promise<void>(resolve => { entered = resolve; });
  let nextId = 0;
  const releases = new WeakMap<object, () => void>();
  const ids = new WeakMap<object, number>();
  const deps = {
    transaction() {
      const id = ++nextId;
      const tx = {
        async begin(level: number) { assert.equal(level, 4); events.push(id + ":begin"); },
        async commit() { events.push(id + ":commit"); releases.get(tx)?.(); },
        async rollback() { events.push(id + ":rollback"); releases.get(tx)?.(); },
      };
      ids.set(tx, id); return tx as unknown as sql.Transaction;
    },
    request(tx: sql.Transaction) {
      return { async query(text: string) {
        assert.equal(text, legacyWorkstationWriterFenceSql);
        const previous = tail;
        tail = new Promise<void>(resolve => { releases.set(tx, resolve); });
        await previous; events.push(ids.get(tx) + ":gate"); return { recordset: [] };
      } } as unknown as sql.Request;
    },
  };
  const pool = {} as sql.ConnectionPool;
  const first = withLegacyWorkstationTransaction(pool, async () => { events.push("1:work"); entered(); await hold; }, deps);
  await firstEntered;
  const second = withLegacyWorkstationTransaction(pool, async () => { events.push("2:work"); }, deps);
  assert.ok(!events.includes("2:work")); releaseFirst();
  await Promise.all([first,second]);
  assert.ok(events.indexOf("1:commit") < events.indexOf("2:work"));
  assert.ok(events.indexOf("2:gate") < events.indexOf("2:work"));
});
