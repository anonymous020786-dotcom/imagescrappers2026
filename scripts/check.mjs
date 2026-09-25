// Static checks run by CI (and locally with `npm run check`):
//  - every JS file parses
//  - manifest.json and locale files are valid and consistent
//  - package.json and manifest versions match
//  - every file referenced by the manifest and HTML pages exists
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (msg) => errors.push(msg);

function walk(dir) {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// 1. Syntax.
const jsFiles = ['src', 'scripts', 'tests'].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.m?js$/.test(f));
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    fail(`Syntax error in ${relative(ROOT, f)}:\n${err.stderr}`);
  }
}

// 2. Manifest + locales.
const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) fail(`Version mismatch: manifest ${manifest.version} vs package.json ${pkg.version}`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`Invalid manifest version "${manifest.version}"`);

const usedKeys = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
const localesDir = join(ROOT, 'src', '_locales');
for (const locale of readdirSync(localesDir)) {
  const messages = JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8'));
  for (const key of usedKeys) if (!messages[key]?.message) fail(`_locales/${locale} is missing "${key}"`);
  if (messages.extName?.message.length > 75) fail(`_locales/${locale} extName is longer than 75 characters`);
  if (messages.extDescription?.message.length > 132) fail(`_locales/${locale} extDescription is longer than 132 characters`);
}

// 3. Referenced files exist.
const refs = new Set([
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.options_ui?.page,
].filter(Boolean));
for (const r of refs) if (!existsSync(join(ROOT, 'src', r))) fail(`manifest references missing file ${r}`);

for (const html of walk(join(ROOT, 'src')).filter((f) => f.endsWith('.html'))) {
  const text = readFileSync(html, 'utf8');
  for (const [, ref] of text.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (!existsSync(join(dirname(html), ref))) fail(`${relative(ROOT, html)} references missing file ${ref}`);
  }
}

// 4. Imports resolve.
for (const f of jsFiles.filter((p) => p.includes(`${join(ROOT, 'src')}`))) {
  for (const [, spec] of readFileSync(f, 'utf8').matchAll(/^import .* from '(\.[^']+)';$/gm)) {
    if (!existsSync(join(dirname(f), spec))) fail(`${relative(ROOT, f)} imports missing ${spec}`);
  }
}

if (errors.length) {
  console.error(`✘ ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`✔ ${jsFiles.length} JS files parse, manifest v${manifest.version} valid, all referenced files exist`);
