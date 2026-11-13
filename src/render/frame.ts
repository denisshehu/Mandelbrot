import { LOG10_2, View } from '../math/view';
import type { OrbitResult } from './orbit';

export interface Settings {
  /** Used when `autoIterations` is off. */
  maxIterations: number;
  autoIterations: boolean;
  escapeRadius: number;
  colormap: string;
  /** Size of each cell in pixels, for a pixelated look. 1 renders every pixel. */
  cellSize: number;
}

export const defaultSettings: Settings = {
  maxIterations: 1000,
  autoIterations: true,
  escapeRadius: 256,
  colormap: 'default',
  cellSize: 1,
};

/** The highest iteration limit, set by how many orbit points fit in a texture. */
export const MAX_ITERATIONS = 10_000_000;

export interface Reference extends OrbitResult {
  x: bigint;
  y: bigint;
  bits: number;
  maxIterations: number;
  escapeRadius: number;
}

/**
 * The iteration limit for a zoom level when it's set to automatic: 1000 for
 * the overview, then 500 more for every 10x of zoom past 100x.
 */
export function autoIterations(log2Width: number): number {
  const decades = (2 - log2Width) * LOG10_2;
  const value = Math.max(1000, 500 * decades);
  const rounding = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return Math.min(MAX_ITERATIONS, Math.round(value / rounding) * rounding);
}

export function iterationsFor(settings: Settings, view: View): number {
  return settings.autoIterations ? autoIterations(view.log2Width) : settings.maxIterations;
}

/** Splits the pixel size of a view shown `logicalWidth` pixels wide into the shader's form. */
export function pixelGeometry(log2Width: number, logicalWidth: number) {
  const log2Pixel = log2Width - Math.log2(logicalWidth);
  const exponent = Math.floor(log2Pixel);
  return { log2Pixel, exponent, pixelScale: 2 ** (log2Pixel - exponent) };
}

/** Whether a reference orbit still works for a view, so it doesn't have to be recomputed. */
export function canReuseReference(
  reference: Reference,
  view: View,
  logicalWidth: number,
  maxIterations: number,
  escapeRadius: number,
): boolean {
  if (reference.escapeRadius !== escapeRadius) return false;
  if (!reference.escaped && reference.maxIterations < maxIterations) return false;
  const { log2Pixel } = pixelGeometry(view.log2Width, logicalWidth);
  if (reference.bits < Math.ceil(-log2Pixel) + 24) return false;
  const [dx, dy] = view.offsetInPixels(referenceView(reference, view), logicalWidth);
  return Math.abs(dx) <= logicalWidth && Math.abs(dy) <= logicalWidth;
}

/** The reference point as a view, to measure its distance from the current one. */
export function referenceView(reference: Reference, view: View): View {
  return new View(reference.x, reference.y, reference.bits, view.log2Width);
}
