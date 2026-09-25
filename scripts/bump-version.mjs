// Sets the version in src/manifest.json and package.json.
//   node scripts/bump-version.mjs 1.2.0
//   node scripts/bump-version.mjs patch|minor|major
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [join(ROOT, 'src', 'manifest.json'), join(ROOT, 'package.json')];
const current = JSON.parse(readFileSync(files[0], 'utf8')).version;
const arg = process.argv[2];

let next = arg;
if (['major', 'minor', 'patch'].includes(arg)) {
  const [ma = 0, mi = 0, pa = 0] = current.split('.').map(Number);
  next = { major: `${ma + 1}.0.0`, minor: `${ma}.${mi + 1}.0`, patch: `${ma}.${mi}.${pa + 1}` }[arg];
}
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('Usage: node scripts/bump-version.mjs <x.y.z | major | minor | patch>');
  process.exit(1);
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
}
console.log(`${current} → ${next}`);
