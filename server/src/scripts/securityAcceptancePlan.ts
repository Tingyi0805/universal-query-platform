/** Offline only: no driver, application config, dotenv, socket, subprocess or database execution. */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Direct installation prerequisites, including earlier ALTER/seed dependencies; not a runtime permission map.
export const prerequisites: Record<number, number[]> = {
  1: [], 2: [], 3: [2], 4: [3], 5: [1, 3], 6: [1, 3, 5], 7: [3, 5], 8: [1],
  9: [2], 10: [9], 11: [5], 12: [1, 5], 13: [1, 3], 14: [1, 3, 5],
  15: [8, 14], 16: [6, 8], 17: [1, 5], 18: [6], 19: [1], 20: [1, 5],
  21: [20], 22: [21], 23: [4], 24: [22], 25: [1, 20], 26: [25],
  900: [25], 901: [25], 902: [], 903: [], 904: [902], 905: [902],
  906: [], 907: [3], 908: [906], 909: [25, 906], 910: [3, 6],
  911: [910], 912: [910], 913: [3, 20], 914: [913], 915: [912, 914],
  916: [1, 6, 25, 902, 904, 906, 915], 917: [5, 20, 914], 918: [25, 917],
  919: [3, 6, 7, 907, 910, 913], 920: [3, 907, 910, 919],
};
export const migrationsDirectory = fileURLToPath(new URL("../../../database/migrations/", import.meta.url));
export const acceptanceDirectory = fileURLToPath(new URL("../../../database/acceptance/", import.meta.url));
export type InventoryItem = { id: number; file: string; sha256: string; requires: number[] };
export async function inventory(directory = migrationsDirectory): Promise<InventoryItem[]> {
  const files = (await readdir(directory)).filter(file => /^\d+_.*\.sql$/i.test(file)).sort((a, b) => a.localeCompare(b));
  const result: InventoryItem[] = [];
  for (const file of files) {
    const id = Number(file.split("_")[0]);
    if (!Object.hasOwn(prerequisites, id) || result.some(row => row.id === id)) throw new Error("MIGRATION_INVENTORY_REVIEW_REQUIRED");
    result.push({ id, file, sha256: createHash("sha256").update(await readFile(path.join(directory, file))).digest("hex"), requires: prerequisites[id]! });
  }
  if (result.length !== Object.keys(prerequisites).length) throw new Error("MIGRATION_INVENTORY_INCOMPLETE");
  const seen = new Set<number>();
  for (const row of result) {
    if (row.requires.some(id => !seen.has(id))) throw new Error("MIGRATION_DEPENDENCY_ORDER_INVALID");
    seen.add(row.id);
  }
  return result;
}
export function selectProfile(rows: InventoryItem[], profile: string) {
  if (profile !== "legacy" && profile !== "coexistence") throw new Error("PROFILE_INVALID");
  // Phase 4B-2 profiles remain pinned through 919. Migration 920 requires its
  // own future SQL Server acceptance and must not silently enter an old plan.
  const selected = rows.filter(row => row.id !== 920 && (profile === "coexistence" || ![916, 917, 918].includes(row.id)));
  const ids = new Set(selected.map(row => row.id));
  if (selected.some(row => row.requires.some(id => !ids.has(id)))) throw new Error("PROFILE_DEPENDENCY_MISSING");
  return selected;
}
export function validateTarget(host: string, port: string, database: string) {
  // Descriptor only. Loopback can be forwarded: operator must independently attest dedicated isolation.
  if (host !== "127.0.0.1" || !/^[1-9][0-9]{4}$/.test(port) || Number(port) < 14330 || Number(port) > 65535 ||
      !/^UQP_ACCEPT_[a-f0-9]{12}$/.test(database)) throw new Error("ISOLATED_TARGET_REQUIRED");
  return { host, port: Number(port), database };
}
export async function plan(args: string[]) {
  const allowed = new Set(["--profile", "--host", "--port", "--database"]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!allowed.has(key) || options.has(key) || !value || value.startsWith("--")) throw new Error("OFFLINE_ARGUMENT_INVALID");
    options.set(key, value);
  }
  const targetArgs = ["--host", "--port", "--database"];
  const target = targetArgs.some(key => options.has(key))
    ? validateTarget(...targetArgs.map(key => options.get(key) ?? "") as [string, string, string]) : null;
  const actual = await inventory();
  const pinned: unknown = JSON.parse(await readFile(path.join(acceptanceDirectory, "migration-inventory.json"), "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(pinned)) throw new Error("MIGRATION_HASH_OR_DEPENDENCY_CHANGED");
  const profile = options.get("--profile") ?? "legacy";
  return { mode: "OFFLINE_PLAN_ONLY", executable: false, connectsToDatabase: false, target,
    profile, migrations: selectProfile(actual, profile),
    warning: "No execution or write mode exists. Review the runbook before any future live acceptance." };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  plan(process.argv.slice(2)).then(value => process.stdout.write(JSON.stringify(value, null, 2) + "\n"))
    .catch(() => { process.stderr.write("Offline acceptance plan refused; check arguments and pinned inventory.\n"); process.exitCode = 1; });
}
