// GLSL for the three passes: iterate the pixels, reduce the results to a
// min/max for the color scale, and color the pixels with a colormap.

export const ORBIT_TEXTURE_WIDTH = 4096;

/** A triangle that covers the whole target. */
export const fullscreenVertex = /* glsl */ `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Advances every pixel by up to uSteps iterations, using perturbation theory:
 * instead of z, the shader tracks the difference delta = z - Z between the
 * pixel's orbit and the reference orbit Z, which follows
 *
 *   delta' = 2 Z delta + delta^2 + dc
 *
 * and stays small. delta is stored as w * 2^k with a separate exponent k, so
 * it doesn't underflow at zooms past 1e-38. When the pixel's orbit gets closer
 * to 0 than to the reference, or the reference runs out, the pixel is
 * "rebased" onto the start of the reference orbit.
 *
 * The 24 bits of a float aren't enough near minibrots, even at shallow zooms,
 * so Z, w and dc are double-single numbers: a pair of floats (hi, lo) whose
 * sum carries about 48 bits, close to a 64-bit double.
 *
 * State 0 holds w as (re hi, re lo, im hi, im lo). State 1 holds
 * (n, status, m, k) while running, where m is the index into the reference
 * orbit, and (n, status, smooth n, k) once done. Status is 0 while running,
 * 1 once escaped and 2 for points that are taken to be in the set.
 */
export const iterateFragment = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uState0;
uniform sampler2D uState1;
uniform sampler2D uOrbit;
uniform int uOrbitLength;
uniform int uSteps;
uniform bool uReset;
uniform float uMaxIterations;
uniform float uEscape2;
// dc = (gl_FragCoord.xy + uOrigin) * uPixelScale * 2^uExponent, with uOrigin
// as (x hi, x lo, y hi, y lo) and uPixelScale as (hi, lo).
uniform vec4 uOrigin;
uniform vec2 uPixelScale;
uniform float uExponent;
// The reference point as a float, for skipping the main cardioid and bulb.
uniform vec2 uReference;
uniform bool uSkipBulbs;
// Always 0. XOR-ing with it hides values from the compiler, see opaque().
uniform uint uZero;

layout(location = 0) out vec4 outState0;
layout(location = 1) out vec4 outState1;

const int ORBIT_WIDTH = ${ORBIT_TEXTURE_WIDTH};

// GPU compilers rewrite float math as if it were exact, for example
// (a + b) - a into b, or (Z * u) * u into Z * (u * u). That breaks the
// double-single tricks below and can overflow. Passing a value through
// opaque() makes the compiler compute it as written.
float opaque(float x) {
  return uintBitsToFloat(floatBitsToUint(x) ^ uZero);
}

// 2^e for a whole number e, built from the bits so it's exact. exp2() is
// only approximate on many GPUs. Values below 2^-126 flush to 0.
float pow2(float e) {
  if (e < -126.0) return 0.0;
  return uintBitsToFloat(uint(int(min(e, 127.0)) + 127) << 23);
}

vec2 twoSum(float a, float b) {
  float s = opaque(a + b);
  float v = opaque(s - a);
  return vec2(s, opaque(a - opaque(s - v)) + opaque(b - v));
}

vec2 quickTwoSum(float a, float b) {
  float s = opaque(a + b);
  return vec2(s, opaque(b - opaque(s - a)));
}

vec2 split(float a) {
  float t = opaque(4097.0 * a);
  float hi = opaque(t - opaque(t - a));
  return vec2(hi, opaque(a - hi));
}

vec2 add(vec2 a, vec2 b) {
  vec2 s = twoSum(a.x, b.x);
  vec2 t = twoSum(a.y, b.y);
  s = quickTwoSum(s.x, s.y + t.x);
  return quickTwoSum(s.x, s.y + t.y);
}

vec2 mul(vec2 a, vec2 b) {
  float p = opaque(a.x * b.x);
  vec2 sa = split(a.x);
  vec2 sb = split(b.x);
  float e = opaque(opaque(opaque(opaque(sa.x * sb.x) - p) + opaque(sa.x * sb.y)) + opaque(sa.y * sb.x)) + opaque(sa.y * sb.y);
  return quickTwoSum(p, e + (a.x * b.y + a.y * b.x));
}

// Complex numbers as vec4(re hi, re lo, im hi, im lo).
vec4 cadd(vec4 a, vec4 b) {
  return vec4(add(a.xy, b.xy), add(a.zw, b.zw));
}

vec4 cmul(vec4 a, vec4 b) {
  return vec4(add(mul(a.xy, b.xy), -mul(a.zw, b.zw)), add(mul(a.xy, b.zw), mul(a.zw, b.xy)));
}

/** Multiplies by a power of two, which is exact for both parts. */
vec4 cscale(vec4 a, float power) {
  return vec4(opaque(a.x * power), opaque(a.y * power), opaque(a.z * power), opaque(a.w * power));
}

vec4 orbit(int m) {
  return texelFetch(uOrbit, ivec2(m % ORBIT_WIDTH, m / ORBIT_WIDTH), 0);
}

// log2 of |v|, without squaring v first, so tiny values don't underflow.
float log2Length(vec2 v) {
  float size = max(abs(v.x), abs(v.y));
  if (size == 0.0) return -1e30;
  vec2 unit = v / size;
  return log2(size) + 0.5 * log2(dot(unit, unit));
}

bool inMainCardioidOrBulb(vec2 c) {
  float x = c.x - 0.25;
  float q = x * x + c.y * c.y;
  if (q * (q + x) <= 0.25 * c.y * c.y) return true;
  float bx = c.x + 1.0;
  return bx * bx + c.y * c.y <= 0.0625;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 d = vec4(
    mul(add(vec2(gl_FragCoord.x, 0.0), uOrigin.xy), uPixelScale),
    mul(add(vec2(gl_FragCoord.y, 0.0), uOrigin.zw), uPixelScale)
  );

  vec4 state0;
  vec4 state1;
  if (uReset) {
    state0 = vec4(0.0);
    state1 = vec4(0.0, 0.0, 0.0, uExponent);
    if (uSkipBulbs && inMainCardioidOrBulb(uReference + d.xz * exp2(uExponent))) {
      state1 = vec4(uMaxIterations, 2.0, uMaxIterations, uExponent);
    }
  } else {
    state0 = texelFetch(uState0, pixel, 0);
    state1 = texelFetch(uState1, pixel, 0);
  }
  if (state1.y != 0.0) {
    outState0 = state0;
    outState1 = state1;
    return;
  }

  vec4 w = state0;
  float n = state1.x;
  int m = int(state1.z);
  float k = state1.w;
  float status = 0.0;
  float smoothN = 0.0;

  for (int i = 0; i < uSteps; i++) {
    vec4 Z = orbit(m);
    float scale = pow2(k);
    vec2 z = Z.xz + w.xz * scale;
    float z2 = dot(z, z);
    if (z2 > uEscape2) {
      status = 1.0;
      smoothN = n + 1.0 - log2(0.5 * log2(z2));
      break;
    }
    if (n >= uMaxIterations) {
      status = 2.0;
      smoothN = n;
      break;
    }
    // Rebase when |z| < |delta|. Only possible when |Z| is about as small as
    // |delta|, so compare logs first: squares of values this small underflow.
    bool atEnd = m >= uOrbitLength - 1;
    if (atEnd || log2Length(Z.xz) < log2Length(w.xz) + k + 1.0) {
      // z / 2^k = Z / 2^k + w, in two steps so 2^-k doesn't overflow.
      float half1 = floor(-0.5 * k);
      vec4 zw = cadd(cscale(cscale(Z, pow2(half1)), pow2(-k - half1)), w);
      if (atEnd || dot(zw.xz, zw.xz) < dot(w.xz, w.xz)) {
        w = zw;
        m = 0;
        Z = vec4(0.0);
      }
    }
    // w' = 2 Z w + 2^k w^2 + dc / 2^k
    vec4 next = cscale(cmul(Z, w), 2.0);
    if (k > -120.0) next = cadd(next, cscale(cmul(w, w), scale));
    float dScale = pow2(uExponent - k);
    if (dScale > 0.0) next = cadd(next, cscale(d, dScale));
    w = next;
    m += 1;
    n += 1.0;
    // Keep w near 1 by moving powers of two into k.
    float size = max(abs(w.x), abs(w.z));
    if (size > 4294967296.0 || (size < 2.3283064e-10 && size > 0.0)) {
      float e = floor(log2(size));
      w = cscale(w, pow2(-e));
      k += e;
    }
  }

  outState0 = w;
  outState1 = vec4(n, status, status == 0.0 ? float(m) : smoothN, k);
}
`;

/**
 * Shrinks the target 8x8 times per pass into (min smooth n, max smooth n,
 * pixels still running). On the first pass it reads state 1 directly.
 */
export const reduceFragment = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uInput;
uniform ivec2 uInputSize;
uniform bool uFirst;

out vec4 outValue;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 8;
  float lowest = 1e30;
  float highest = -1e30;
  float running = 0.0;
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      ivec2 p = base + ivec2(x, y);
      if (p.x >= uInputSize.x || p.y >= uInputSize.y) continue;
      vec4 v = texelFetch(uInput, p, 0);
      if (uFirst) {
        if (v.y == 1.0) {
          lowest = min(lowest, v.z);
          highest = max(highest, v.z);
        } else if (v.y == 0.0) {
          running += 1.0;
        }
      } else {
        lowest = min(lowest, v.x);
        highest = max(highest, v.y);
        running += v.z;
      }
    }
  }
  outValue = vec4(lowest, highest, running, 0.0);
}
`;

/**
 * Colors escaped pixels by their smooth iteration count on a log scale (see
 * logRange in renderer.ts). Pixels that are still running show the previous frame,
 * moved and scaled to where it sits in the new view.
 */
export const colorFragment = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uState1;
uniform sampler2D uColormap;
uniform sampler2D uPrevious;
uniform bool uHasPrevious;
uniform vec2 uPreviousSize;
// previous pixel = gl_FragCoord.xy * uPreviousTransform.x + uPreviousTransform.yz
uniform vec3 uPreviousTransform;
uniform float uPreviousDim;
// t = (log(n - uLogRange.x) - uLogRange.y) * uLogRange.z
uniform vec3 uLogRange;

out vec4 outColor;

vec4 colormap(float t) {
  int size = textureSize(uColormap, 0).x;
  int index = clamp(int(t * float(size)), 0, size - 1);
  return texelFetch(uColormap, ivec2(index, 0), 0);
}

void main() {
  vec4 state = texelFetch(uState1, ivec2(gl_FragCoord.xy), 0);
  if (state.y == 1.0) {
    outColor = colormap((log(max(state.z - uLogRange.x, 1.0)) - uLogRange.y) * uLogRange.z);
  } else if (state.y == 2.0) {
    outColor = colormap(1.0);
  } else {
    vec2 p = gl_FragCoord.xy * uPreviousTransform.x + uPreviousTransform.yz;
    bool inside = all(greaterThanEqual(p, vec2(0.0))) && all(lessThan(p, uPreviousSize));
    outColor = uHasPrevious && inside
      ? vec4(texture(uPrevious, p / uPreviousSize).rgb * uPreviousDim, 1.0)
      : colormap(1.0);
  }
}
`;

/** Draws a texture to the canvas, with each texel covering uCellSize pixels. */
export const blitFragment = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uImage;
uniform float uCellSize;

out vec4 outColor;

void main() {
  outColor = texelFetch(uImage, ivec2(gl_FragCoord.xy / uCellSize), 0);
}
`;
