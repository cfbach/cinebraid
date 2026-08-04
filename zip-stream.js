/* Minimal dependency-free ZIP writer for CineBraid exports.
   Uses the ZIP "store" method (no compression) and streams files without
   buffering the complete archive in memory. ZIP64 is intentionally omitted;
   individual files and total archives must remain below 4 GiB. */
const fs = require("fs");
const path = require("path");
const { once } = require("events");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function updateCrc(crc, buffer) {
  let value = crc >>> 0;
  for (let i = 0; i < buffer.length; i++)
    value = CRC_TABLE[(value ^ buffer[i]) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function dosDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const dosTime =
    ((date.getHours() & 31) << 11) |
    ((date.getMinutes() & 63) << 5) |
    (Math.floor(date.getSeconds() / 2) & 31);
  const dosDate =
    (((year - 1980) & 127) << 9) |
    (((date.getMonth() + 1) & 15) << 5) |
    (date.getDate() & 31);
  return { dosTime, dosDate };
}

function safeEntryName(name) {
  const normalized = String(name || "file")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const clean = path.posix
    .normalize(normalized)
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\.\//, "");
  if (!clean || clean === "." || clean.includes("\0"))
    throw new Error("Invalid ZIP entry name.");
  return clean;
}

class SimpleZipWriter {
  constructor(output) {
    this.output = output;
    this.offset = 0;
    this.entries = [];
    this.closed = false;
  }

  async write(buffer) {
    if (this.closed) throw new Error("ZIP writer is already closed.");
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    if (this.offset + buffer.length > 0xffffffff)
      throw new Error("Export exceeds the 4 GiB ZIP limit.");
    if (!this.output.write(buffer)) await once(this.output, "drain");
    this.offset += buffer.length;
  }

  async addBuffer(name, input, modified = new Date()) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
    return this._add(name, modified, async (emit) => emit(buffer));
  }

  async addFile(name, filePath) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
    return this._add(name, stat.mtime, async (emit) => {
      for await (const chunk of fs.createReadStream(filePath))
        await emit(chunk);
    });
  }

  async _add(name, modified, producer) {
    const entryName = safeEntryName(name);
    const nameBuffer = Buffer.from(entryName, "utf8");
    if (nameBuffer.length > 0xffff)
      throw new Error(`ZIP entry name is too long: ${entryName}`);
    const localOffset = this.offset;
    const { dosTime, dosDate } = dosDateTime(modified);
    const flags = 0x0808; // UTF-8 + data descriptor

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // store, no compression
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    await this.write(local);
    await this.write(nameBuffer);

    let crc = 0xffffffff;
    let size = 0;
    await producer(async (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 0xffffffff)
        throw new Error(`ZIP entry exceeds 4 GiB: ${entryName}`);
      crc = updateCrc(crc, buffer);
      await this.write(buffer);
    });
    crc = (crc ^ 0xffffffff) >>> 0;

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(size >>> 0, 8);
    descriptor.writeUInt32LE(size >>> 0, 12);
    await this.write(descriptor);

    this.entries.push({
      entryName,
      nameBuffer,
      localOffset,
      crc,
      size,
      dosTime,
      dosDate,
      flags,
    });
  }

  async finalize() {
    if (this.closed) return;
    if (this.entries.length > 0xffff)
      throw new Error("ZIP export contains too many files.");
    const centralOffset = this.offset;

    for (const entry of this.entries) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(entry.flags, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(entry.dosTime, 12);
      central.writeUInt16LE(entry.dosDate, 14);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(entry.size >>> 0, 20);
      central.writeUInt32LE(entry.size >>> 0, 24);
      central.writeUInt16LE(entry.nameBuffer.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(entry.localOffset >>> 0, 42);
      await this.write(central);
      await this.write(entry.nameBuffer);
    }

    const centralSize = this.offset - centralOffset;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralSize >>> 0, 12);
    end.writeUInt32LE(centralOffset >>> 0, 16);
    end.writeUInt16LE(0, 20);
    await this.write(end);
    this.closed = true;
    this.output.end();
  }
}

module.exports = { SimpleZipWriter };
