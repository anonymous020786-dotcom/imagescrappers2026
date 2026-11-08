// Copies the store screenshots and extension icons into public/assets, so the images live in one place
// (store/chrome and src/icons). Runs before `next dev` and `next build`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(WEB, '..');
const assets = join(WEB, 'public', 'assets');
mkdirSync(assets, { recursive: true });

for (let i = 1; i <= 5; i++) copyFileSync(join(ROOT, 'store', 'chrome', `screenshot-${i}.png`), join(assets, `screenshot-${i}.png`));
for (const size of [32, 128]) copyFileSync(join(ROOT, 'src', 'icons', `icon${size}.png`), join(assets, `icon${size}.png`));
if (!existsSync(join(assets, 'og-image.png'))) throw new Error('web/public/assets/og-image.png is missing: run `npm run site:og` in the repository root');
console.log('✔ copied screenshots and icons into web/public/assets');
