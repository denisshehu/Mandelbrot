import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng } from '../src/export/png';

describe('PNG encoder', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes pixels that decode back to the input', async () => {
    const width = 5;
    const height = 3;
    const pixel = (x: number, y: number) => [x * 50, y * 100, (x + y) * 20];
    const blob = await encodePng(width, height, (y, row) => {
      for (let x = 0; x < width; x++) row.set(pixel(x, y), x * 3);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');

    // IHDR is 8 + 13 + 4 bytes after the signature, then the IDAT chunk.
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(16)).toBe(width);
    expect(view.getUint32(20)).toBe(height);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(bytes.subarray(41, 41 + idatLength));

    const stride = width * 3 + 1;
    for (let y = 0; y < height; y++) {
      expect(raw[y * stride]).toBe(1);
      const row = raw.subarray(y * stride + 1, (y + 1) * stride);
      for (let i = 3; i < row.length; i++) row[i] = (row[i] + row[i - 3]) & 255;
      for (let x = 0; x < width; x++) expect([...row.subarray(x * 3, x * 3 + 3)]).toEqual(pixel(x, y));
    }
  });
});
