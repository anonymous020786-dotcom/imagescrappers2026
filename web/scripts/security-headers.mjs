// Writes out/_headers for Netlify with a Content-Security-Policy that allows exactly the inline scripts
// Next.js put in the exported pages (by SHA-256 hash), instead of allowing every inline script.
// Runs after `next build`. Other security and cache headers stay in ../netlify.toml.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Executable inline scripts only: JSON-LD and other data blocks never run, so CSP ignores them.
const EXECUTABLE = /^(|text\/javascript|application\/javascript|module)$/i;
const hashes = new Set();
let pages = 0;
for (const file of walk(OUT).filter((f) => f.endsWith('.html'))) {
  pages++;
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    if (/\ssrc\s*=/i.test(attrs) || !m[2]) continue;
    const type = (/\stype\s*=\s*"([^"]*)"/i.exec(attrs) ?? [])[1] ?? '';
    if (!EXECUTABLE.test(type.trim())) continue;
    hashes.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
}

const csp = [
  "default-src 'self'",
  "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `script-src 'self' https://www.googletagmanager.com ${[...hashes].sort().join(' ')}`,
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  'frame-src https://app.netlify.com',
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

writeFileSync(join(OUT, '_headers'), `/*\n  Content-Security-Policy: ${csp}\n`);
console.log(`✔ out/_headers: CSP with ${hashes.size} inline script hashes from ${pages} pages (${csp.length} characters)`);
