export interface OrbitRequest {
  id: number;
  /** The reference point, as fixed-point BigInts at `bits`. */
  x: bigint;
  y: bigint;
  bits: number;
  maxIterations: number;
  escapeRadius: number;
}

export interface OrbitResult {
  id: number;
  /**
   * Z_0, Z_1, ... as double-single floats: four per point, (re hi, re lo,
   * im hi, im lo), where hi + lo is the value to about 48 bits.
   */
  points: Float32Array;
  /** Number of points in `points`. The last one escaped unless `escaped` is false. */
  length: number;
  escaped: boolean;
}

/**
 * Iterates Z -> Z^2 + C in fixed-point arithmetic for the reference point and
 * returns every Z. The renderer computes all other pixels as small offsets
 * from this orbit, which works in (double-single) floats.
 */
export function computeOrbit(request: OrbitRequest): OrbitResult {
  const { x: cx, y: cy, bits, maxIterations, escapeRadius } = request;
  const shift = BigInt(bits);
  const shiftMinusOne = BigInt(bits - 1);
  const limit = BigInt(Math.ceil(escapeRadius * escapeRadius)) << shift;
  // Converting through a 60-bit window keeps Number() from overflowing.
  const drop = BigInt(Math.max(0, bits - 60));
  const toFloat = 2 ** -(bits - Number(drop));
  const store = (index: number, x: bigint, y: bigint) => {
    const re = Number(x >> drop) * toFloat;
    const im = Number(y >> drop) * toFloat;
    points[4 * index] = re;
    points[4 * index + 1] = re - points[4 * index];
    points[4 * index + 2] = im;
    points[4 * index + 3] = im - points[4 * index + 2];
  };

  const points = new Float32Array(4 * (maxIterations + 1));
  let zx = 0n;
  let zy = 0n;
  let length = 1;
  let escaped = false;
  for (let n = 0; n < maxIterations; n++) {
    const xx = (zx * zx) >> shift;
    const yy = (zy * zy) >> shift;
    if (xx + yy > limit) {
      escaped = true;
      break;
    }
    const xy = (zx * zy) >> shiftMinusOne;
    zx = xx - yy + cx;
    zy = xy + cy;
    store(n + 1, zx, zy);
    length = n + 2;
  }
  if (!escaped) {
    escaped = (zx * zx + zy * zy) >> shift > limit;
  }
  return { id: request.id, points: points.slice(0, 4 * length), length, escaped };
}
