import { describe, expect, it } from 'vitest';
import { bigIntToFloat, floatToBigInt, formatCompact, formatDecimal, parseDecimal, rescale } from '../src/math/fixed';
import { formatLog2, log2OfDecimal, View } from '../src/math/view';
import { computeOrbit } from '../src/render/orbit';
import { autoIterations } from '../src/render/frame';

describe('fixed-point numbers', () => {
  it('parses and formats decimals without losing digits', () => {
    const text = '-0.7435178331234567890123456789012345678901';
    const value = parseDecimal(text, 200);
    expect(formatDecimal(value, 200, 40)).toBe(text);
  });

  it('parses scientific notation', () => {
    expect(parseDecimal('1.5e-3', 64)).toBe(parseDecimal('0.0015', 64));
    expect(parseDecimal('2E2', 8)).toBe(200n << 8n);
  });

  it('writes long runs of zeros and nines as an offset', () => {
    const bits = 1100;
    const zeros = '0'.repeat(250);
    const cases: [string, string][] = [
      [`0.${zeros}1230633196517119`, '1.230633196517119e-251'],
      [`-0.${zeros}1230633196517119`, '-1.230633196517119e-251'],
      [`1.${zeros}6225050029`, '1+6.225050029e-251'],
      [`-1.${zeros}6225050029`, '-1-6.225050029e-251'],
      [`0.${'9'.repeat(250)}37`, '1-6.3e-251'],
      ['-0.7402776210643411570978928523895011668604', '-0.7402776210643411570978928523895011668604'],
      ['0.00012345', '0.00012345'],
      ['100000000.5', '100000000.5'],
      ['0', '0'],
    ];
    for (const [text, compact] of cases) {
      const value = parseDecimal(text, bits);
      expect(formatCompact(value, bits, 300)).toBe(compact);
      expect(parseDecimal(compact, bits)).toBe(value);
    }
  });

  it('rejects text that is not a number', () => {
    expect(() => parseDecimal('abc', 64)).toThrow();
    expect(() => parseDecimal('.', 64)).toThrow();
  });

  it('converts between floats and BigInts', () => {
    expect(floatToBigInt(0.75, 4)).toBe(12n);
    expect(floatToBigInt(-3, 0)).toBe(-3n);
    expect(bigIntToFloat(12n, -4)).toBe(0.75);
    expect(bigIntToFloat(1n << 300n, -300)).toBe(1);
    expect(rescale(12n, 4, 2)).toBe(3n);
  });
});

describe('view', () => {
  it('keeps the point under the cursor fixed when zooming', () => {
    const view = View.fromStrings('-0.5', '0', '4');
    const zoomed = view.zoomAt(8, 100, -50, 1000);
    // The point 100 px right and 50 px down of the center, in plane units.
    const before = [-0.5 + (100 * 4) / 1000, (-50 * 4) / 1000];
    const [ox, oy] = view.offsetInPixels(zoomed, 1000);
    const after = [-0.5 + (ox * 4) / 1000 + (100 * 0.5) / 1000, (oy * 4) / 1000 + (-50 * 0.5) / 1000];
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
  });

  it('pans by whole pixels even at depths past 64-bit floats', () => {
    const view = View.fromStrings('-0.743517833', '0.127094578', '1e-200');
    const moved = view.pan(250, -10, 1000);
    const [dx, dy] = view.offsetInPixels(moved, 1000);
    expect(dx).toBeCloseTo(250, 6);
    expect(dy).toBeCloseTo(-10, 6);
  });

  it('formats widths in scientific notation when small', () => {
    expect(formatLog2(log2OfDecimal('4.2'))).toBe('4.2');
    expect(formatLog2(log2OfDecimal('3.5e-250'))).toBe('3.5e-250');
  });

  it('round-trips a view through strings', () => {
    const view = View.fromStrings('0.16125', '0.638438', '0.05').zoomAt(1e20, 3, 7, 800);
    const { x, y, width } = view.toStrings();
    const parsed = View.fromStrings(x, y, width);
    const [dx, dy] = view.offsetInPixels(parsed, 800);
    expect(Math.abs(dx)).toBeLessThan(1e-3);
    expect(Math.abs(dy)).toBeLessThan(1e-3);
  });
});

describe('reference orbit', () => {
  it('matches a float64 orbit for a point that escapes', () => {
    const bits = 80;
    const result = computeOrbit({ id: 1, x: parseDecimal('-0.75', bits), y: parseDecimal('0.1', bits), bits, maxIterations: 1000, escapeRadius: 256 });
    let zx = 0;
    let zy = 0;
    let n = 0;
    while (zx * zx + zy * zy <= 256 * 256 && n < 1000) {
      [zx, zy] = [zx * zx - zy * zy - 0.75, 2 * zx * zy + 0.1];
      n++;
    }
    expect(result.escaped).toBe(true);
    expect(result.length).toBe(n + 1);
    expect(result.points[4 * n] + result.points[4 * n + 1]).toBeCloseTo(zx, 6);
  });

  it('stops at the iteration limit for a point in the set', () => {
    const result = computeOrbit({ id: 1, x: 0n, y: 0n, bits: 64, maxIterations: 500, escapeRadius: 2 });
    expect(result.escaped).toBe(false);
    expect(result.length).toBe(501);
  });
});

describe('automatic iterations', () => {
  it('uses 1000 for the overview and grows with zoom', () => {
    expect(autoIterations(Math.log2(4.2))).toBe(1000);
    expect(autoIterations(Math.log2(1e-13))).toBeGreaterThan(5000);
    expect(autoIterations(Math.log2(1e-30))).toBeGreaterThan(autoIterations(Math.log2(1e-13)));
  });
});
