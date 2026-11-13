export interface Colormap {
  id: string;
  name: string;
  /** Evenly spaced color stops. The last one also colors the set itself. */
  stops: string[];
}

/** Entries in the lookup table, the same as the original matplotlib colormap. */
export const COLORMAP_SIZE = 1024;

// The first one is the palette of the original Python version.
export const colormaps: Colormap[] = [
  { id: 'default', name: 'Default', stops: ['#000764', '#206BCB', '#FFFFFF', '#FFAA00', '#000000'] },
  { id: 'ember', name: 'Ember', stops: ['#0B0307', '#5C0F1B', '#C2361A', '#FF9F1C', '#FFF1C1', '#000000'] },
  { id: 'ice', name: 'Ice', stops: ['#00040F', '#0B2A5B', '#2E86C1', '#BDE6F7', '#FFFFFF', '#000000'] },
  { id: 'lagoon', name: 'Lagoon', stops: ['#001219', '#005F73', '#0A9396', '#94D2BD', '#E9D8A6', '#000000'] },
  { id: 'forest', name: 'Forest', stops: ['#020D07', '#0F3D2E', '#2E8B57', '#A8D672', '#F4F1C9', '#000000'] },
  { id: 'sunset', name: 'Sunset', stops: ['#12002B', '#5B1A6E', '#C8336B', '#F88F45', '#FFE7A8', '#000000'] },
  { id: 'neon', name: 'Neon', stops: ['#05010F', '#2B0B5E', '#00D1FF', '#F0FFFF', '#FF2E97', '#000000'] },
  { id: 'copper', name: 'Copper', stops: ['#0A0604', '#3D2416', '#9C5B33', '#E8A86B', '#FFF0DC', '#000000'] },
  { id: 'mono', name: 'Mono', stops: ['#050505', '#2A2A2A', '#BDBDBD', '#FFFFFF', '#000000'] },
];

export function findColormap(id: string): Colormap {
  return colormaps.find((colormap) => colormap.id === id) ?? colormaps[0];
}

/** Builds an RGBA lookup table by interpolating linearly between the stops. */
export function buildLookupTable(colormap: Colormap, size = COLORMAP_SIZE): Uint8Array {
  const stops = colormap.stops.map(parseHex);
  const table = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const position = (i / (size - 1)) * (stops.length - 1);
    const index = Math.min(Math.floor(position), stops.length - 2);
    const t = position - index;
    for (let channel = 0; channel < 3; channel++) {
      const value = stops[index][channel] * (1 - t) + stops[index + 1][channel] * t;
      table[i * 4 + channel] = Math.round(value);
    }
    table[i * 4 + 3] = 255;
  }
  return table;
}

/** A CSS gradient that previews the colormap in the Colors pop-up. */
export function cssGradient(colormap: Colormap): string {
  return `linear-gradient(90deg, ${colormap.stops.join(', ')})`;
}

function parseHex(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
