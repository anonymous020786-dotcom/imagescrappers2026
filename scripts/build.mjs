// Builds browser-specific packages from src/ with no dependencies.
//
//   node scripts/build.mjs            # all targets
//   node scripts/build.mjs chrome     # one target
//
// Output: dist/<target>/ (unpacked, load it in the browser) and
//         dist/image-scraper-pro-<target>-<version>.zip (store upload).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipWriter } from '../src/lib/zip.js';

// Zip timestamps are stored as local time; pin the zone so output is identical everywhere.
process.env.TZ = 'UTC';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const GECKO_ID = 'image-scraper-pro@imagescrappers2026';

const base = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));

const clone = (o) => JSON.parse(JSON.stringify(o));

// Chromium builds ask for access to all sites at runtime (optional_host_permissions); other browsers declare it.
function requiredHostAccess(m) {
  const { optional_host_permissions: hosts, ...rest } = m;
  const out = {};
  for (const [key, value] of Object.entries(rest)) {
    out[key] = value;
    if (key === 'permissions' && hosts) out.host_permissions = hosts;
  }
  return out;
}

const TARGETS = {
  // Chromium family shares the same MV3 manifest.
  chrome: (m) => m,
  edge: (m) => m,
  brave: (m) => m,
  opera: (m) => m,
  vivaldi: (m) => m,

  firefox: (m) => {
    // Firefox lets users grant or withhold site access themselves (and optional_host_permissions needs
    // Firefox 128+), so keep <all_urls> as a regular host permission there.
    m = requiredHostAccess(m);
    // Firefox MV3 uses an event page instead of a service worker.
    m.background = { scripts: ['background/background.js'], type: 'module' };
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '121.0',
        // Declares that no user data leaves the device (required for new AMO listings).
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '121.0' },
    };
    m.options_ui = { page: 'options/options.html', open_in_tab: true };
    return m;
  },

  safari: (m) => {
    m = requiredHostAccess(m);
    // Safari Web Extensions (via xcrun safari-web-extension-converter).
    // Safari has no downloads API; the dashboard falls back to <a download>.
    m.permissions = m.permissions.filter((p) => p !== 'downloads');
    m.background = { scripts: ['background/background.js'], type: 'module', persistent: false };
    m.browser_specific_settings = { safari: { strict_min_version: '16.4' } };
    return m;
  },
};

// Fixed timestamp for zip entries so builds are byte-for-byte reproducible
// (CI checks that the committed dist/ matches a fresh build).
// Override with SOURCE_DATE_EPOCH (seconds) if needed.
const BUILD_DATE = new Date(Number(process.env.SOURCE_DATE_EPOCH ?? 1767225600) * 1000);

function listFiles(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

function build(target) {
  const out = join(DIST, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(SRC, out, { recursive: true, filter: (p) => !p.endsWith('.DS_Store') });
  const manifest = TARGETS[target](clone(base));
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const zip = new ZipWriter();
  for (const file of listFiles(out)) zip.add(relative(out, file).split('\\').join('/'), readFileSync(file), BUILD_DATE);
  const zipPath = join(DIST, `image-scraper-pro-${target}-${manifest.version}.zip`);
  writeFileSync(zipPath, zip.finish());
  console.log(`✔ ${target.padEnd(8)} → ${relative(ROOT, out)}  (${relative(ROOT, zipPath)})`);
}

const requested = process.argv.slice(2);
const targets = requested.length ? requested : Object.keys(TARGETS);
for (const t of targets) {
  if (!TARGETS[t]) {
    console.error(`Unknown target "${t}". Available: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
  build(t);
}
if (targets.includes('safari')) {
  console.log('\nSafari: run on macOS →  xcrun safari-web-extension-converter dist/safari --app-name "Image Scraper Pro"');
}
