// Minimal zip reader (stored + deflate, no zip64). Enough for Kane .evidence packs.
const zlib = require("zlib");

function entries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.push({ name, method, compSize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf, entry) {
  const p = entry.local;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error("corrupt local header: " + entry.name);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 256 * 1024 * 1024 });
  throw new Error(`unsupported compression ${entry.method} in ${entry.name}`);
}

module.exports = { entries, read };
