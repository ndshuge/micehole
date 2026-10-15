import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean).map(p => p.replaceAll('\\', '/'));
const errors = [];
const forbidden = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:secrets|credentials|private-keys)\//i,
  /\.(?:pem|p12|pfx|p8|jks|key)$/i,
  /(^|\/)(?:dist|node_modules|build-tools)\//i,
  /(^|\/)qa-config\.json$/i,
];
for (const file of tracked) {
  if (forbidden.some(re => re.test(file))) errors.push('Tracked sensitive/generated path: ' + file);
  if (!fs.existsSync(path.join(root, file))) errors.push('Missing tracked file: ' + file);
}
for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md', '.editorconfig', 'docs/SECURITY.md', 'docs/RELEASE.md', '.github/workflows/smoke-tests.yml']) {
  if (!fs.existsSync(path.join(root, file))) errors.push('Missing repository baseline: ' + file);
}
console.log(JSON.stringify({ ok: errors.length === 0, tracked: tracked.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
