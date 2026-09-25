// Minimal, dependency-free ZIP writer (STORE method).
// Images are already compressed, so deflating them again gains little and
// costs a lot of CPU; storing keeps archive creation fast and streaming-free.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export class ZipWriter {
  constructor() {
    this.chunks = [];
    this.central = [];
    this.offset = 0;
    this.names = new Set();
  }

  // Ensure every entry name is unique inside the archive.
  uniqueName(name) {
    if (!this.names.has(name)) {
      this.names.add(name);
      return name;
    }
    const dot = name.lastIndexOf('.');
    const base = dot > name.lastIndexOf('/') ? name.slice(0, dot) : name;
    const ext = dot > name.lastIndexOf('/') ? name.slice(dot) : '';
    let i = 1;
    while (this.names.has(`${base} (${i})${ext}`)) i++;
    const unique = `${base} (${i})${ext}`;
    this.names.add(unique);
    return unique;
  }

  add(name, data, date = new Date()) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const entryName = this.uniqueName(name.replace(/\\/g, '/').replace(/^\/+/, ''));
    const nameBytes = new TextEncoder().encode(entryName);
    const crc = crc32(bytes);
    const { time, day } = dosDateTime(date);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // store
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, bytes.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, this.offset, true);

    this.chunks.push(new Uint8Array(local.buffer), nameBytes, bytes);
    this.central.push(new Uint8Array(cd.buffer), nameBytes);
    this.offset += 30 + nameBytes.length + bytes.length;
    return entryName;
  }

  get count() {
    return this.names.size;
  }

  // Returns a Uint8Array with the complete archive.
  finish() {
    const cdSize = this.central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, this.offset, true);
    const parts = [...this.chunks, ...this.central, new Uint8Array(end.buffer)];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }
}
