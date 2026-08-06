type ZipEntry = { name: string; data: Buffer };

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name: Buffer, data: Buffer, crc: number) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name: Buffer, data: Buffer, crc: number, offset: number) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10); header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
  return header;
}

export function createZip(entries: ZipEntry[]) {
  const seen = new Set<string>(); const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.includes('..') || entry.name.includes('/') || entry.name.includes('\\')) throw new Error('unsafe zip entry');
    if (seen.has(entry.name)) throw new Error('duplicate zip entry'); seen.add(entry.name);
    const name = Buffer.from(entry.name, 'utf8'); const crc = crc32(entry.data); const header = localHeader(name, entry.data, crc);
    local.push(header, name, entry.data); central.push(centralHeader(name, entry.data, crc, offset), name); offset += header.length + name.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
