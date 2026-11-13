import { bigIntToFloat, floatToBigInt, formatCompact, parseDecimal, rescale } from './fixed';

/** log10(2), to convert between powers of two and ten. */
export const LOG10_2 = Math.log10(2);

/** The widest view you can zoom out to, in units of the complex plane. */
export const MAX_WIDTH = 16;
/** The narrowest view, about 1e-300. Below that the width no longer fits in a float. */
export const MIN_LOG2_WIDTH = -1000;

/**
 * The part of the complex plane on screen: a center with arbitrary precision
 * and the width of the plane shown, stored as log2(width) so it can get far
 * smaller than the smallest float.
 */
export class View {
  constructor(
    /** Real part of the center, as a fixed-point BigInt at `bits`. */
    readonly x: bigint,
    /** Imaginary part of the center, as a fixed-point BigInt at `bits`. */
    readonly y: bigint,
    readonly bits: number,
    readonly log2Width: number,
  ) {}

  static fromStrings(x: string, y: string, width: string): View {
    const log2Width = clampLog2Width(log2OfDecimal(width));
    const bits = bitsFor(log2Width);
    return new View(parseDecimal(x, bits), parseDecimal(y, bits), bits, log2Width);
  }

  /** The width as a float, or 0 once it underflows. */
  get width(): number {
    return 2 ** this.log2Width;
  }

  /** Moves the center by a number of pixels, for a canvas `canvasWidth` pixels wide. */
  pan(dx: number, dy: number, canvasWidth: number): View {
    // Offset in the plane = pixels / canvasWidth * 2^log2Width.
    const whole = Math.floor(this.log2Width);
    const fraction = 2 ** (this.log2Width - whole) / canvasWidth;
    const shift = whole + this.bits;
    return new View(
      this.x + floatToBigInt(dx * fraction, shift),
      this.y + floatToBigInt(dy * fraction, shift),
      this.bits,
      this.log2Width,
    );
  }

  /**
   * Zooms by `factor` (above 1 zooms in) while keeping the point at pixel
   * offset (px, py) from the center in the same place on screen.
   */
  zoomAt(factor: number, px: number, py: number, canvasWidth: number): View {
    const log2Width = clampLog2Width(this.log2Width - Math.log2(factor));
    const actual = 2 ** (this.log2Width - log2Width);
    const moved = this.pan(px * (1 - 1 / actual), py * (1 - 1 / actual), canvasWidth);
    return moved.withLog2Width(log2Width);
  }

  withLog2Width(log2Width: number): View {
    const bits = bitsFor(log2Width);
    return new View(
      rescale(this.x, this.bits, bits),
      rescale(this.y, this.bits, bits),
      bits,
      log2Width,
    );
  }

  /** The offset of `other`'s center from this one, in pixels of this view. */
  offsetInPixels(other: View, canvasWidth: number): [number, number] {
    const bits = Math.max(this.bits, other.bits);
    const dx = rescale(other.x, other.bits, bits) - rescale(this.x, this.bits, bits);
    const dy = rescale(other.y, other.bits, bits) - rescale(this.y, this.bits, bits);
    const shift = -bits - this.log2Width + Math.log2(canvasWidth);
    return [bigIntToFloat(dx, shift), bigIntToFloat(dy, shift)];
  }

  /** Decimal strings for the center and width, with as many digits as the zoom needs. */
  toStrings(): { x: string; y: string; width: string } {
    const digits = Math.max(4, Math.ceil(-this.log2Width * LOG10_2) + 6);
    return {
      x: formatCompact(this.x, this.bits, digits),
      y: formatCompact(this.y, this.bits, digits),
      width: formatLog2(this.log2Width),
    };
  }

  equals(other: View): boolean {
    return (
      this.log2Width === other.log2Width &&
      rescale(this.x, this.bits, other.bits) === other.x &&
      rescale(this.y, this.bits, other.bits) === other.y
    );
  }
}

/** Fractional bits the center needs at a zoom level: the pixel size plus a margin. */
export function bitsFor(log2Width: number): number {
  return Math.max(64, Math.ceil(-log2Width) + 64);
}

function clampLog2Width(log2Width: number): number {
  return Math.min(Math.log2(MAX_WIDTH), Math.max(MIN_LOG2_WIDTH, log2Width));
}

/** log2 of a positive decimal string, also for values below the smallest float. */
export function log2OfDecimal(text: string): number {
  const match = /^\s*\+?(\d*\.?\d*)(?:e([+-]?\d+))?\s*$/i.exec(text);
  const mantissa = match ? Number(match[1]) : NaN;
  if (!match || !(mantissa > 0)) throw new Error(`"${text}" is not a positive number`);
  return Math.log2(mantissa) + Number(match[2] ?? 0) * Math.log2(10);
}

/** Formats 2^log2 as a decimal, switching to scientific notation for small values. */
export function formatLog2(log2: number, precision = 6): string {
  const log10 = log2 * LOG10_2;
  if (log10 > -4 && log10 < 6) return String(Number((2 ** log2).toPrecision(precision)));
  let exponent = Math.floor(log10);
  let mantissa = Number((10 ** (log10 - exponent)).toPrecision(precision));
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${mantissa}e${exponent}`;
}
