import { View } from '../math/view';
import { findColormap } from '../render/colormaps';
import { defaultSettings, type Settings } from '../render/frame';

// The location and settings live in the URL hash, so a link opens the same
// spot: #x=-0.7&y=0&w=4.2&cm=ember. Only settings that differ from the
// defaults are written. URLSearchParams isn't used, because it would turn the
// "+" in coordinates like y=1+6.2e-251 into "%2B" when writing and into a
// space when reading.

export function readHash(hash: string): { view: View | null; settings: Partial<Settings> } {
  const params = parseParams(hash.replace(/^#/, ''));
  const settings: Partial<Settings> = {};
  let view: View | null = null;
  const x = params.get('x');
  const y = params.get('y');
  const width = params.get('w');
  if (x && y && width) {
    try {
      view = View.fromStrings(x, y, width);
    } catch {
      view = null;
    }
  }
  const iterations = Number(params.get('it'));
  if (iterations > 0) {
    settings.maxIterations = Math.round(iterations);
    settings.autoIterations = false;
  }
  const radius = Number(params.get('r'));
  if (radius >= 2) settings.escapeRadius = radius;
  const colormap = params.get('cm');
  if (colormap) settings.colormap = findColormap(colormap).id;
  const cellSize = Number(params.get('cs'));
  if ([1, 2, 4, 8, 16, 32].includes(cellSize)) settings.cellSize = cellSize;
  return { view, settings };
}

export function writeHash(view: View, settings: Settings): void {
  const { x, y, width } = view.toStrings();
  const params = new Map([['x', x], ['y', y], ['w', width]]);
  if (!settings.autoIterations) params.set('it', String(settings.maxIterations));
  if (settings.escapeRadius !== defaultSettings.escapeRadius) params.set('r', String(settings.escapeRadius));
  if (settings.colormap !== defaultSettings.colormap) params.set('cm', settings.colormap);
  if (settings.cellSize !== defaultSettings.cellSize) params.set('cs', String(settings.cellSize));
  const text = [...params].map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%2B/g, '+')}`);
  history.replaceState(null, '', `#${text.join('&')}`);
}

function parseParams(text: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of text.split('&')) {
    const [key, value = ''] = part.split('=');
    try {
      if (key) params.set(decodeURIComponent(key), decodeURIComponent(value));
    } catch {
      // Ignore malformed escapes.
    }
  }
  return params;
}
