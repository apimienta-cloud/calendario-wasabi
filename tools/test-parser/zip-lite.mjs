// zip-lite.mjs — Lector mínimo de .zip para Node (solo para pruebas).
// Igual que zip.js en el navegador: lee el directorio central del final del
// archivo y descomprime ÚNICAMENTE las entradas pedidas, sin cargar el resto
// (los videos embebidos nunca se leen).
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const { bytesRead } = await fh.read(buf, off, len - off, pos + off);
    if (!bytesRead) break;
    off += bytesRead;
  }
  return buf.subarray(0, off);
}

export async function openZip(path) {
  const fh = await open(path, 'r');
  const { size } = await fh.stat();
  const tailLen = Math.min(size, 65557 + 20);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No es un zip válido (no se encontró el directorio central).');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  // ZIP64
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
      const z64pos = Number(tail.readBigUInt64LE(loc + 8));
      const z64 = await readAt(fh, z64pos, 56);
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
  }
  const cd = await readAt(fh, cdOffset, cdSize);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10);
    let compSize = cd.readUInt32LE(p + 20);
    let uncompSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    // extra ZIP64
    let e = p + 46 + nameLen; const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e), len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompSize === 0xffffffff) { uncompSize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + len;
    }
    entries.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return {
    size,
    entries,
    async readText(entry) {
      const lh = await readAt(fh, entry.localOffset, 30);
      const start = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const data = await readAt(fh, start, entry.compSize);
      const raw = entry.method === 0 ? data : inflateRawSync(data);
      return raw.toString('utf8');
    },
    close: () => fh.close(),
  };
}
