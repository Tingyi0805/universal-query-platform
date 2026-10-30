// Read-only byte counts; run after a clean build in the source checkout.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const revision = process.argv[2] ?? 'HEAD';
const tree = execFileSync('git', ['ls-tree', '-rlz', revision], { cwd: root, encoding: 'utf8' });
const tracked = tree.split('\0').filter(Boolean).map(row => Number(row.split('\t')[0].trim().split(/\s+/)[3]));
function build(relative) {
  const directory = path.join(root, relative);
  if (!existsSync(directory)) return { built: false };
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name), info = statSync(file);
      if (info.isDirectory()) walk(file);
      else if (info.isFile()) files.push({ path: path.relative(root, file).replaceAll('\\', '/'), bytes: info.size });
    }
  }
  walk(directory);
  return { built: true, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    compiledTests: files.filter(file => /\.test(?:Fixture)?\.js$/.test(file.path)).map(file => file.path) };
}
console.log(JSON.stringify({ trackedRevision: execFileSync('git', ['rev-parse', revision], { cwd: root, encoding: 'utf8' }).trim(),
  buildCheckout: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  tracked: { files: tracked.length, bytes: tracked.reduce((sum, size) => sum + size, 0) },
  builds: { server: build('server/dist'), client: build('client/dist') } }, null, 2));
