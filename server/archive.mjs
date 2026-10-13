// Reading the release packages (.zip and .tar.gz) with Node's own zlib, so
// the offline updater works on a machine with nothing else installed.
// Only plain files and folders are accepted: links, absolute paths and ".."
// are refused, so a package cannot write outside the folder it goes into.
import * as zlib from 'node:zlib';

export class ArchiveError extends Error {}

// safePath('a/b/c') -> 'a/b/c'; throws for anything that could escape.
export function safePath(name) {
  const clean = name.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.includes('\0')) throw new ArchiveError(`unsafe path: ${name}`);
  const parts = clean.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.some((p) => p === '..')) throw new ArchiveError(`unsafe path: ${name}`);
  return parts.join('/');
}

// Each entry: { path, dir, mode, data() }.
export function readArchive(buf) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return readZip(buf);
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return readTar(zlib.gunzipSync(buf));
  throw new ArchiveError('not a .zip or .tar.gz file');
}

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ArchiveError('zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new ArchiveError('zip64 is not supported');
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new ArchiveError('zip: bad central directory');
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nlen = buf.readUInt16LE(at + 28), elen = buf.readUInt16LE(at + 30), clen = buf.readUInt16LE(at + 32);
    const madeBy = buf.readUInt16LE(at + 4) >> 8;
    const attr = buf.readUInt32LE(at + 38);
    const local = buf.readUInt32LE(at + 42);
    const raw = buf.subarray(at + 46, at + 46 + nlen).toString('utf8');
    at += 46 + nlen + elen + clen;
    const dir = raw.endsWith('/');
    const unixMode = madeBy === 3 ? attr >>> 16 : 0;
    if (unixMode && (unixMode & 0o170000) === 0o120000) throw new ArchiveError(`links are not allowed: ${raw}`);
    const path = safePath(raw);
    out.push({
      path, dir, mode: unixMode & 0o777,
      data() {
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new ArchiveError(`zip: bad entry ${raw}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const body = buf.subarray(start, start + csize);
        let data;
        if (method === 0) data = Buffer.from(body);
        else if (method === 8) data = zlib.inflateRawSync(body);
        else throw new ArchiveError(`zip: compression ${method} is not supported`);
        if (data.length !== size || (zlib.crc32 && zlib.crc32(data) >>> 0 !== crc)) throw new ArchiveError(`zip: ${raw} is damaged`);
        return data;
      },
    });
  }
  return out;
}

function readTar(buf) {
  const out = [];
  const octal = (b) => { const s = b.toString('latin1').replace(/\0.*$/s, '').trim(); return s ? parseInt(s, 8) : 0; };
  const str = (b) => b.toString('utf8').replace(/\0.*$/s, '');
  let longName = null, paxPath = null;
  for (let at = 0; at + 512 <= buf.length;) {
    const h = buf.subarray(at, at + 512);
    if (h.every((x) => x === 0)) break;
    const size = octal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = str(body); continue; }
    if (type === 'x') {
      for (const rec of body.toString('utf8').split('\n')) {
        const m = rec.match(/^\d+ path=(.*)$/);
        if (m) paxPath = m[1];
      }
      continue;
    }
    if (type === 'g') continue;
    const prefix = str(h.subarray(345, 500));
    let name = longName ?? paxPath ?? (prefix ? `${prefix}/${str(h.subarray(0, 100))}` : str(h.subarray(0, 100)));
    longName = paxPath = null;
    if (type !== '0' && type !== '5' && type !== '7') throw new ArchiveError(`only files and folders are allowed: ${name} (type ${type})`);
    const path = safePath(name);
    const data = Buffer.from(body);
    out.push({ path, dir: type === '5', mode: octal(h.subarray(100, 108)) & 0o777, data: () => data });
  }
  return out;
}
