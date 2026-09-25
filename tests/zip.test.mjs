import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipWriter, crc32 } from '../src/lib/zip.js';

test('crc32 matches the reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZipWriter produces an archive that standard tools can read', () => {
  const zip = new ZipWriter();
  zip.add('a.txt', new TextEncoder().encode('hello'));
  zip.add('folder/b.bin', new Uint8Array([0, 1, 2, 255]));
  const dupe = zip.add('a.txt', new TextEncoder().encode('again'));
  zip.add('ünïcödé.txt', new TextEncoder().encode('utf8'));
  assert.equal(dupe, 'a (1).txt');
  const bytes = zip.finish();

  const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
  const file = join(dir, 'out.zip');
  writeFileSync(file, bytes);

  const py = `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print('|'.join(sorted(z.namelist())))
print(z.read('a.txt').decode(), z.read('a (1).txt').decode(), list(z.read('folder/b.bin')))`;
  let out;
  try {
    out = execFileSync('python3', ['-c', py, file], { encoding: 'utf8' });
  } catch (err) {
    if (err.code === 'ENOENT') return; // python not available: skip external validation
    throw err;
  }
  const [names, contents] = out.trim().split('\n');
  assert.equal(names, 'a (1).txt|a.txt|folder/b.bin|ünïcödé.txt');
  assert.equal(contents, 'hello again [0, 1, 2, 255]');
  assert.ok(readFileSync(file).length > 0);
});
