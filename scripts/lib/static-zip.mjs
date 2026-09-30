// Deterministic UTF-8 ZIPs made only from the build's explicit file allowlist.
// STORE avoids zlib-version-dependent bytes across supported Node build runtimes.
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let j = 0; j < 8; j += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function staticZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("Unsafe ZIP path");
    const path = Buffer.from(name), data = Buffer.from(content), compressed = data;
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(path.length, 26);
    local.push(header, path, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    header.copy(entry, 8, 6, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, path); offset += header.length + path.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
