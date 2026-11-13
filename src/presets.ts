import { formatLog2, log2OfDecimal, View } from './math/view';

/**
 * A place in the set. `width` and `height` are the part of the plane that has
 * to be visible, centered on (x, y): the shape itself for the full set and the
 * minibrot, and the framing it was composed in for the others. The view is
 * fitted to the screen around it, so nothing gets cut off on a wide or tall
 * window.
 */
export interface Preset {
  id: string;
  name: string;
  x: string;
  y: string;
  width: string;
  height: string;
  /** A fixed iteration limit, for deep spots that need more than the automatic one. */
  maxIterations?: number;
}

// Flower and Seahorse valley are the images the original Python version
// generated, in 16:9. The full set comes first and is the starting view.
export const presets: Preset[] = [
  // From the tip of the antenna at -2 to the right edge of the cardioid, with the arms.
  { id: 'mandelbrot', name: 'Full set', x: '-0.765', y: '0', width: '2.51', height: '2.3' },
  { id: 'flower', name: 'Flower', x: '0.16125', y: '0.638438', width: '0.05', height: '0.028125' },
  { id: 'seahorse', name: 'Seahorse valley', x: '-0.743517833', y: '0.127094578', width: '0.019', height: '0.0106875' },
  { id: 'elephant', name: 'Elephant valley', x: '0.285', y: '0.0115', width: '0.012', height: '0.0075' },
  // The largest copy of the set on the real axis, a cardioid of period 3, with its arms.
  { id: 'minibrot', name: 'Minibrot', x: '-1.7663', y: '0', width: '0.04', height: '0.0384' },
  { id: 'spiral', name: 'Spiral', x: '-0.77568377', y: '0.13646737', width: '0.0004', height: '0.00025' },
  {
    id: 'deep-spiral',
    name: 'Deep spiral',
    x: '-0.7402776210643411570978928523895011668604',
    y: '0.126970455870465485787492543780366642616971',
    width: '3.65927e-36',
    height: '2.05834e-36',
  },
  // c = i is a tip of a filament, so it shows the same branching at any depth.
  { id: 'lightning', name: 'Lightning', x: '0', y: '1', width: '1e-250', height: '5.625e-251' },
];

/** Space to leave around a preset, in CSS pixels, clear of the buttons and pills. */
const MARGIN = { x: 48, y: 72 };

/** The view that shows all of `preset` on a canvas of this size, with a margin. */
export function fitView(preset: Preset, cssWidth: number, cssHeight: number): View {
  const width = Math.max(cssWidth, 1);
  const height = Math.max(cssHeight, 1);
  const availableWidth = Math.max(width - 2 * MARGIN.x, width / 2);
  const availableHeight = Math.max(height - 2 * MARGIN.y, height / 2);
  // In log2, since deep presets are far below what a float can hold.
  const log2Width = Math.max(
    log2OfDecimal(preset.width) + Math.log2(width / availableWidth),
    log2OfDecimal(preset.height) + Math.log2(width / availableHeight),
  );
  return View.fromStrings(preset.x, preset.y, formatLog2(log2Width, 3));
}
