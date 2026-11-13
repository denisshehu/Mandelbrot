// Fixed-point numbers stored as a BigInt with a number of fractional bits:
// the value of `v` at `bits` is v / 2^bits. They hold the center of the view,
// which needs more digits than a 64-bit float has once you zoom in deep.

/**
 * Parses a decimal string like "-0.7435e-3" into a fixed-point BigInt. It
 * also takes sums like "1+6.2e-251", the short form of a number with a long
 * run of zeros that `formatCompact` writes.
 */
export function parseDecimal(text: string, bits: number): bigint {
  // Split before each sign that doesn't belong to an exponent.
  const terms = text.replace(/\s+/g, '').split(/(?<=[\d.])(?=[+-])/);
  if (terms.length > 1) return terms.reduce((sum, term) => sum + parseTerm(term, text, bits), 0n);
  return parseTerm(text, text, bits);
}

function parseTerm(term: string, text: string, bits: number): bigint {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?\s*$/i.exec(term);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new Error(`"${text}" is not a number`);
  }
  const [, sign, whole, fraction = '', exponent = '0'] = match;
  let digits = BigInt((whole || '0') + fraction);
  let scale = fraction.length - Number(exponent);

  // value = digits * 10^-scale, so value * 2^bits = digits * 2^bits / 10^scale
  let result: bigint;
  if (scale <= 0) {
    result = (digits * 10n ** BigInt(-scale)) << BigInt(bits);
  } else {
    const divisor = 10n ** BigInt(scale);
    digits <<= BigInt(bits);
    result = (digits + divisor / 2n) / divisor;
  }
  return sign === '-' ? -result : result;
}

/** Formats a fixed-point BigInt as a decimal string with `digits` decimals. */
export function formatDecimal(value: bigint, bits: number, digits: number): string {
  return decimal(scaleToDigits(value, bits, digits), digits);
}

/** Runs of zeros or nines at least this long are written as an offset. */
const MIN_RUN = 8;

/**
 * Formats a fixed-point BigInt with `digits` decimals like `formatDecimal`,
 * but writes a long run of zeros or nines after the point as an offset in
 * scientific notation: 0.000000000123 becomes "1.23e-10" and 1.000000000456
 * becomes "1+4.56e-10".
 */
export function formatCompact(value: bigint, bits: number, digits: number): string {
  const scaled = scaleToDigits(value, bits, digits);
  const negative = scaled < 0n;
  const text = (negative ? -scaled : scaled).toString().padStart(digits + 1, '0');
  const trimmed = text.replace(/0+$/, '');
  const run = new RegExp(`0{${MIN_RUN},}|9{${MIN_RUN},}`).exec(trimmed);
  // Runs in the whole part stay, and so do nines that end the number.
  if (!run || run.index + run[0].length <= text.length - digits || run.index + run[0].length === trimmed.length) {
    return decimal(scaled, digits);
  }

  // |scaled| = head + tail, with head rounded up over a run of nines.
  const unit = 10n ** BigInt(text.length - run.index);
  const magnitude = negative ? -scaled : scaled;
  const head = (magnitude / unit + (run[0][0] === '9' ? 1n : 0n)) * unit;
  const sign = negative ? -1n : 1n;
  const tail = scientific(sign * (magnitude - head), digits);
  if (head === 0n) return tail;
  return `${decimal(sign * head, digits)}${tail.startsWith('-') ? '' : '+'}${tail}`;
}

/** Returns round(value / 2^bits * 10^digits). */
function scaleToDigits(value: bigint, bits: number, digits: number): bigint {
  const magnitude = value < 0n ? -value : value;
  const scaled = (magnitude * 10n ** BigInt(digits) + (1n << BigInt(bits - 1))) >> BigInt(bits);
  return value < 0n ? -scaled : scaled;
}

/** Writes scaled * 10^-digits as a decimal, without trailing zeros. */
function decimal(scaled: bigint, digits: number): string {
  const negative = scaled < 0n;
  let text = (negative ? -scaled : scaled).toString().padStart(digits + 1, '0');
  if (digits > 0) {
    text = `${text.slice(0, -digits)}.${text.slice(-digits)}`.replace(/\.?0+$/, '');
  }
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

/** Writes scaled * 10^-digits in scientific notation, like "-4.56e-10". */
function scientific(scaled: bigint, digits: number): string {
  const negative = scaled < 0n;
  const text = (negative ? -scaled : scaled).toString();
  const mantissa = `${text[0]}.${text.slice(1)}`.replace(/\.?0+$/, '');
  return `${negative ? '-' : ''}${mantissa}e${text.length - 1 - digits}`;
}

/** Changes the number of fractional bits of a fixed-point BigInt. */
export function rescale(value: bigint, fromBits: number, toBits: number): bigint {
  if (toBits >= fromBits) return value << BigInt(toBits - fromBits);
  const shift = BigInt(fromBits - toBits);
  return (value + (1n << (shift - 1n))) >> shift;
}

/** Returns round(x * 2^shift) as a BigInt, for any float x and integer shift. */
export function floatToBigInt(x: number, shift: number): bigint {
  if (x === 0 || !Number.isFinite(x)) return 0n;
  // Split x into a 53-bit integer mantissa and a power of two.
  const exponent = Math.floor(Math.log2(Math.abs(x))) - 52;
  const mantissa = BigInt(Math.round(x * 2 ** -exponent));
  const total = exponent + shift;
  if (total >= 0) return mantissa << BigInt(total);
  const down = BigInt(-total);
  return (mantissa + (1n << (down - 1n))) >> down;
}

/** Returns value * 2^shift as a float, without overflowing on large BigInts. */
export function bigIntToFloat(value: bigint, shift: number): number {
  const length = bitLength(value);
  if (length <= 53) return Number(value) * 2 ** shift;
  const drop = length - 53;
  return Number(value >> BigInt(drop)) * 2 ** (shift + drop);
}

function bitLength(value: bigint): number {
  if (value < 0n) value = -value;
  return value === 0n ? 0 : value.toString(16).length * 4;
}
