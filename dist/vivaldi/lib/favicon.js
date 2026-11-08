// Favicon and app icon pack: an ICO file that embeds PNG images, plus the web manifest and HTML tags.
// Pure functions so they are unit-tested in Node.

export const ICO_SIZES = [16, 32, 48];
// File name for each PNG size in the pack.
export const PNG_ICONS = [
  { size: 16, name: 'favicon-16x16.png' },
  { size: 32, name: 'favicon-32x32.png' },
  { size: 48, name: 'favicon-48x48.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'android-chrome-192x192.png' },
  { size: 512, name: 'android-chrome-512x512.png' },
];

// ICO container with PNG-compressed images (supported by every current browser and Windows Vista+).
// `images` is [{ size, data: Uint8Array of a square PNG }].
export function buildIco(images) {
  if (!images.length) throw new Error('No images for the icon');
  const header = 6 + 16 * images.length;
  const total = header + images.reduce((n, i) => n + i.data.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    out[e] = img.size >= 256 ? 0 : img.size; // 0 means 256
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    out[e + 2] = 0; // palette colours
    out[e + 3] = 0; // reserved
    view.setUint16(e + 4, 1, true); // colour planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, img.data.length, true);
    view.setUint32(e + 12, offset, true);
    out.set(img.data, offset);
    offset += img.data.length;
  });
  return out;
}

export function webManifest(name, themeColor = '#ffffff') {
  const clean = String(name || 'App').slice(0, 45);
  return JSON.stringify(
    {
      name: clean,
      short_name: clean.slice(0, 12),
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: themeColor,
      background_color: themeColor,
      display: 'standalone',
    },
    null,
    2,
  );
}

export function faviconHtml() {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    '',
  ].join('\n');
}
