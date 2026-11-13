import { bigIntToFloat } from '../math/fixed';
import type { View } from '../math/view';
import { buildLookupTable, COLORMAP_SIZE, findColormap } from '../render/colormaps';
import type { Explorer } from '../render/explorer';
import { canReuseReference, iterationsFor, pixelGeometry, referenceView, type Settings } from '../render/frame';
import { OrbitClient } from '../render/orbit-client';
import { logRange } from '../render/renderer';
import { encodePng } from './png';

const TILE_SIZE = 1024;
const TARGET_PASS_MS = 40;

export interface ExportRequest {
  width: number;
  height: number;
  view: View;
  settings: Settings;
}

/**
 * Renders the view at any resolution, in tiles so large images fit in GPU
 * memory, and encodes it as a PNG. The view's width spans the image width,
 * so a different aspect ratio than the screen shows more or less height.
 */
export async function exportPng(
  explorer: Explorer,
  { width, height, view, settings }: ExportRequest,
  onProgress: (fraction: number, label: string) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const { renderer } = explorer;
  const cellSize = settings.cellSize;
  const logicalWidth = width / cellSize;
  const logicalHeight = height / cellSize;
  const columns = Math.ceil(logicalWidth);
  const rows = Math.ceil(logicalHeight);
  const maxIterations = iterationsFor(settings, view);

  explorer.suspend();
  const target = renderer.createTarget(Math.min(TILE_SIZE, columns), Math.min(TILE_SIZE, rows));
  const orbits = new OrbitClient();
  try {
    let reference = explorer.getReference();
    if (!reference || !canReuseReference(reference, view, logicalWidth, maxIterations, settings.escapeRadius)) {
      onProgress(0, 'Computing reference orbit');
      // A few more bits than the screen needs, for the smaller pixels.
      const request = { x: view.x << 32n, y: view.y << 32n, bits: view.bits + 32, maxIterations, escapeRadius: settings.escapeRadius };
      reference = { ...(await orbits.compute(request)), ...request };
    }
    renderer.setOrbit(reference.points, reference.length);
    const [rx, ry] = view.offsetInPixels(referenceView(reference, view), logicalWidth);

    const { exponent, pixelScale } = pixelGeometry(view.log2Width, logicalWidth);
    const smooth = new Float32Array(columns * rows);
    const status = new Uint8Array(columns * rows);
    const tilesX = Math.ceil(columns / target.width);
    const tilesY = Math.ceil(rows / target.height);
    let rate = 20_000;

    for (let tileY = 0; tileY < tilesY; tileY++) {
      for (let tileX = 0; tileX < tilesX; tileX++) {
        const x0 = tileX * target.width;
        const y0 = tileY * target.height;
        target.begin({
          maxIterations,
          escapeRadius: settings.escapeRadius,
          origin: [x0 - logicalWidth / 2 - rx, y0 - logicalHeight / 2 - ry],
          pixelScale,
          exponent,
          reference: [bigIntToFloat(reference.x, -reference.bits), bigIntToFloat(reference.y, -reference.bits)],
          skipBulbs: view.width > 1e-3,
        });
        let running = target.width * target.height;
        while (running > 0 && target.iterations <= maxIterations) {
          if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
          const steps = Math.max(1, Math.min(maxIterations + 1 - target.iterations, Math.floor((rate * TARGET_PASS_MS) / running)));
          const start = performance.now();
          target.step(steps);
          const reduction = target.reduce();
          const elapsed = Math.max(0.5, performance.now() - start);
          rate = 0.7 * rate + 0.3 * ((running * steps) / elapsed);
          running = reduction.running;
          const tileProgress = 1 - running / (target.width * target.height);
          onProgress((tileY * tilesX + tileX + tileProgress) / (tilesX * tilesY), 'Rendering');
          await nextFrame();
        }
        copyTile(target.readState(), target.width, target.height, x0, y0, columns, rows, smooth, status);
      }
    }

    onProgress(1, 'Encoding PNG');
    const range = escapedRange(smooth, status);
    const [offset, low, scale] = logRange(range);
    const table = buildLookupTable(findColormap(settings.colormap));
    const interior = (COLORMAP_SIZE - 1) * 4;
    return await encodePng(
      width,
      height,
      (y, row) => {
        // PNG rows go top-down, the GPU's go bottom-up.
        const source = Math.floor((height - 1 - y) / cellSize) * columns;
        for (let x = 0; x < width; x++) {
          const index = source + Math.floor(x / cellSize);
          let entry = interior;
          if (status[index] === 1) {
            const t = (Math.log(Math.max(smooth[index] - offset, 1)) - low) * scale;
            entry = Math.min(COLORMAP_SIZE - 1, Math.max(0, Math.floor(t * COLORMAP_SIZE))) * 4;
          }
          row[x * 3] = table[entry];
          row[x * 3 + 1] = table[entry + 1];
          row[x * 3 + 2] = table[entry + 2];
        }
      },
      async (y) => {
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        onProgress(y / height, 'Encoding PNG');
        await nextFrame();
      },
    );
  } finally {
    orbits.dispose();
    target.dispose();
    explorer.resume();
  }
}

function copyTile(
  state: Float32Array,
  tileWidth: number,
  tileHeight: number,
  x0: number,
  y0: number,
  columns: number,
  rows: number,
  smooth: Float32Array,
  status: Uint8Array,
): void {
  for (let y = 0; y < tileHeight && y0 + y < rows; y++) {
    for (let x = 0; x < tileWidth && x0 + x < columns; x++) {
      const from = (y * tileWidth + x) * 4;
      const to = (y0 + y) * columns + x0 + x;
      status[to] = state[from + 1];
      smooth[to] = state[from + 2];
    }
  }
}

function escapedRange(smooth: Float32Array, status: Uint8Array) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < smooth.length; i++) {
    if (status[i] !== 1) continue;
    if (smooth[i] < min) min = smooth[i];
    if (smooth[i] > max) max = smooth[i];
  }
  return { min, max };
}

/** Yields to the browser between passes. A timeout, unlike requestAnimationFrame, keeps going in a background tab. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
