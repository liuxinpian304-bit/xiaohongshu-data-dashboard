import { describe, expect, it } from 'vitest';
import { createZip } from './zip-writer';

describe('createZip', () => {
  it('writes the required UTF-8 entries and central directory', () => {
    const zip = createZip([
      { name: 'notes.csv', data: Buffer.from('标题\r\n') },
      { name: 'comments.csv', data: Buffer.from('评论\r\n') },
      { name: 'README.txt', data: Buffer.from('说明') },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from('notes.csv'))).toBe(true);
    expect(zip.includes(Buffer.from('comments.csv'))).toBe(true);
    expect(zip.includes(Buffer.from('README.txt'))).toBe(true);
    expect(zip.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
  });

  it('rejects unsafe or duplicate names', () => {
    expect(() => createZip([{ name: '../secret', data: Buffer.alloc(0) }])).toThrow('unsafe zip entry');
    expect(() => createZip([{ name: 'a', data: Buffer.alloc(0) }, { name: 'a', data: Buffer.alloc(0) }])).toThrow('duplicate zip entry');
  });
});
