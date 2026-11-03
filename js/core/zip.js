// Minimal ZIP reader/writer (deflate via the platform Compression Streams API). No dependencies.
export const enc = new TextEncoder();
export const dec = new TextDecoder("utf-8");

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

async function pipeAll(stream, bytes) {
  const w = stream.writable.getWriter(); w.write(bytes); w.close();
  const out = []; const r = stream.readable.getReader(); let len = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; out.push(value); len += value.length; }
  const res = new Uint8Array(len); let o = 0; for (const c of out) { res.set(c, o); o += c.length; } return res;
}
const inflateRaw = (b) => pipeAll(new DecompressionStream("deflate-raw"), b);
const deflateRaw = (b) => pipeAll(new CompressionStream("deflate-raw"), b);

/** @param {ArrayBuffer|Uint8Array} buf */
export async function readZip(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; } }
  if (e < 0) throw new Error("corrupt zip container");
  const count = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt zip directory");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
      xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const ln = dv.getUint16(loff + 26, true), lx = dv.getUint16(loff + 28, true), ds = loff + 30 + ln + lx;
    files.set(name, { method, raw: u.subarray(ds, ds + csize) });
  }
  return {
    names: () => [...files.keys()],
    has: (n) => files.has(n),
    async read(n) {
      const f = files.get(n); if (!f) throw new Error("missing " + n);
      if (f.method === 0) return f.raw;
      if (f.method === 8) return inflateRaw(f.raw);
      throw new Error("unsupported zip compression method " + f.method);
    },
  };
}

/** @param {{name:string,data:Uint8Array,store?:boolean}[]} entries @returns {Promise<Uint8Array>} */
export async function writeZip(entries) {
  const parts = [], cd = []; let off = 0;
  const dosTime = 0, dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1; // fixed date => reproducible output
  for (const en of entries) {
    const nameB = enc.encode(en.name), crc = crc32(en.data);
    const comp = en.store ? en.data : await deflateRaw(en.data), method = en.store ? 0 : 8;
    const lh = new Uint8Array(30 + nameB.length), d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, 0x0800, true); d.setUint16(8, method, true);
    d.setUint16(10, dosTime, true); d.setUint16(12, dosDate, true); d.setUint32(14, crc, true);
    d.setUint32(18, comp.length, true); d.setUint32(22, en.data.length, true); d.setUint16(26, nameB.length, true);
    lh.set(nameB, 30); parts.push(lh, comp);
    const ch = new Uint8Array(46 + nameB.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, comp.length, true); c.setUint32(24, en.data.length, true); c.setUint16(28, nameB.length, true); c.setUint32(42, off, true);
    ch.set(nameB, 46); cd.push(ch);
    off += lh.length + comp.length;
  }
  const cdSize = cd.reduce((a, b) => a + b.length, 0);
  const eo = new Uint8Array(22), e = new DataView(eo.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...cd, eo], total = all.reduce((a, b) => a + b.length, 0), out = new Uint8Array(total);
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
