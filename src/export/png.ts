// A small PNG encoder for 8-bit RGB images. It streams rows through the
// browser's CompressionStream, so even an 8K image never needs a canvas
// (Safari caps canvases at about 16 million pixels).

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Encodes a width x height RGB image. `fillRow` writes the RGB bytes of row y
 * (0 is the top) into `row`. `onRow` is awaited every so often, so the caller
 * can report progress and keep the page responsive.
 */
export async function encodePng(
  width: number,
  height: number,
  fillRow: (y: number, row: Uint8Array) => void,
  onRow: (y: number) => Promise<void> = async () => {},
): Promise<Blob> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const compressed = new Response(stream.readable).arrayBuffer();

  const stride = width * 3;
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    fillRow(y, row);
    // Filter type 1 ("Sub") stores each byte as the difference from the pixel
    // to its left, which compresses smooth gradients much better.
    const filtered = new Uint8Array(stride + 1);
    filtered[0] = 1;
    filtered.set(row.subarray(0, 3), 1);
    for (let i = 3; i < stride; i++) filtered[i + 1] = (row[i] - row[i - 3]) & 255;
    await writer.ready;
    void writer.write(filtered);
    if (y % 64 === 63) await onRow(y);
  }
  await writer.close();
  const data = new Uint8Array(await compressed);

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return new Blob([SIGNATURE, ...chunk('IHDR', header), ...chunk('IDAT', data), ...chunk('IEND', new Uint8Array())], {
    type: 'image/png',
  });
}

function chunk(type: string, data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>[] {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc32(data, crc32(head.subarray(4))) >>> 0);
  return [head, data, tail];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as PNG uses it. Pass the previous result to continue a running CRC. */
export function crc32(data: Uint8Array, previous?: number): number {
  let crc = previous === undefined ? 0xffffffff : ~previous;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}
