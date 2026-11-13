import {
  blitFragment,
  colorFragment,
  fullscreenVertex,
  iterateFragment,
  ORBIT_TEXTURE_WIDTH,
  reduceFragment,
} from './shaders';

/** Everything the iterate pass needs besides the reference orbit. */
export interface IterationParams {
  maxIterations: number;
  escapeRadius: number;
  /** Added to gl_FragCoord to get a pixel's offset from the reference, in pixels. */
  origin: [number, number];
  /** Pixel size = pixelScale * 2^exponent, with pixelScale in [1, 2). */
  pixelScale: number;
  exponent: number;
  /** The reference point as floats, only used when `skipBulbs` is on. */
  reference: [number, number];
  skipBulbs: boolean;
}

/** The iteration counts that the colormap is stretched over. */
export type ColorRange = Pick<Reduction, 'min' | 'max'>;

export interface Reduction {
  /** Lowest and highest smooth iteration count of the escaped pixels. */
  min: number;
  max: number;
  /** Pixels that haven't escaped or reached the iteration limit yet. */
  running: number;
}

/** A color texture with the size it was made at. */
export interface Image {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  program: WebGLProgram;
  uniforms: Uniforms;
}

/** Owns the WebGL2 context, the shader programs, the orbit and the colormap. */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly iterate: Program;
  private readonly reduce: Program;
  private readonly color: Program;
  private readonly blit: Program;
  private readonly vertexArray: WebGLVertexArrayObject;
  private orbitTexture: WebGLTexture;
  private orbitLength = 0;
  private colormapTexture: WebGLTexture;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('This browser does not support WebGL 2.');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('This browser does not support rendering to floating-point textures (EXT_color_buffer_float).');
    }
    this.gl = gl;
    this.iterate = createProgram(gl, iterateFragment);
    this.reduce = createProgram(gl, reduceFragment);
    this.color = createProgram(gl, colorFragment);
    this.blit = createProgram(gl, blitFragment);
    this.vertexArray = gl.createVertexArray()!;
    this.orbitTexture = gl.createTexture()!;
    this.colormapTexture = gl.createTexture()!;
  }

  /** Uploads the reference orbit as an RGBA32F texture, 4096 points per row. */
  setOrbit(points: Float32Array, length: number): void {
    const { gl } = this;
    const width = Math.min(length, ORBIT_TEXTURE_WIDTH);
    const height = Math.ceil(length / ORBIT_TEXTURE_WIDTH);
    const data = new Float32Array(width * height * 4);
    data.set(points.subarray(0, length * 4));
    gl.bindTexture(gl.TEXTURE_2D, this.orbitTexture);
    setNearest(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    this.orbitLength = length;
  }

  setColormap(table: Uint8Array): void {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
    setNearest(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, table.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, table);
  }

  createTarget(width: number, height: number): IterationTarget {
    return new IterationTarget(this, width, height);
  }

  createImage(width: number, height: number): Image {
    const { gl } = this;
    const texture = createTexture(gl, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer, width, height };
  }

  deleteImage(image: Image): void {
    this.gl.deleteTexture(image.texture);
    this.gl.deleteFramebuffer(image.framebuffer);
  }

  /** @internal */
  runIterate(
    target: IterationTarget,
    params: IterationParams,
    steps: number,
    reset: boolean,
    read: WebGLTexture[],
    write: WebGLFramebuffer,
  ): void {
    const { gl } = this;
    const { program, uniforms: u } = this.iterate;
    gl.useProgram(program);
    bindTexture(gl, 0, read[0], u.uState0);
    bindTexture(gl, 1, read[1], u.uState1);
    bindTexture(gl, 2, this.orbitTexture, u.uOrbit);
    gl.uniform1i(u.uOrbitLength, this.orbitLength);
    gl.uniform1i(u.uSteps, steps);
    gl.uniform1i(u.uReset, reset ? 1 : 0);
    gl.uniform1f(u.uMaxIterations, params.maxIterations);
    gl.uniform1f(u.uEscape2, params.escapeRadius * params.escapeRadius);
    gl.uniform4f(u.uOrigin, ...splitDouble(params.origin[0]), ...splitDouble(params.origin[1]));
    gl.uniform2f(u.uPixelScale, ...splitDouble(params.pixelScale));
    gl.uniform1ui(u.uZero, 0);
    gl.uniform1f(u.uExponent, params.exponent);
    gl.uniform2f(u.uReference, ...params.reference);
    gl.uniform1i(u.uSkipBulbs, params.skipBulbs ? 1 : 0);
    this.draw(write, target.width, target.height);
  }

  /** @internal */
  runReduce(input: WebGLTexture, inputWidth: number, inputHeight: number, first: boolean, output: WebGLFramebuffer, width: number, height: number): void {
    const { gl } = this;
    const { program, uniforms: u } = this.reduce;
    gl.useProgram(program);
    bindTexture(gl, 0, input, u.uInput);
    gl.uniform2i(u.uInputSize, inputWidth, inputHeight);
    gl.uniform1i(u.uFirst, first ? 1 : 0);
    this.draw(output, width, height);
  }

  /**
   * Colors a target into `output`. Pixels that are still running show
   * `previous`, where previous pixel = pixel * transform[0] + transform[1..2],
   * with its brightness multiplied by `dim`.
   */
  colorize(
    target: IterationTarget,
    range: ColorRange,
    output: Image,
    previous: Image | null,
    transform: [number, number, number],
    dim = 1,
  ): void {
    const { gl } = this;
    const { program, uniforms: u } = this.color;
    gl.useProgram(program);
    bindTexture(gl, 0, target.state1, u.uState1);
    bindTexture(gl, 1, this.colormapTexture, u.uColormap);
    bindTexture(gl, 2, previous?.texture ?? this.colormapTexture, u.uPrevious);
    gl.uniform1i(u.uHasPrevious, previous ? 1 : 0);
    gl.uniform2f(u.uPreviousSize, previous?.width ?? 1, previous?.height ?? 1);
    gl.uniform3f(u.uPreviousTransform, ...transform);
    gl.uniform1f(u.uPreviousDim, dim);
    gl.uniform3f(u.uLogRange, ...logRange(range));
    this.draw(output.framebuffer, output.width, output.height);
  }

  /** Draws an image to the canvas, scaled up by `cellSize` without smoothing. */
  present(image: Image, cellSize: number): void {
    const { gl } = this;
    const { program, uniforms: u } = this.blit;
    gl.useProgram(program);
    bindTexture(gl, 0, image.texture, u.uImage);
    gl.uniform1f(u.uCellSize, cellSize);
    this.draw(null, this.canvas.width, this.canvas.height);
  }

  private draw(framebuffer: WebGLFramebuffer | null, width: number, height: number): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.bindVertexArray(this.vertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/**
 * The per-pixel iteration state for one image or one export tile. It
 * ping-pongs between two pairs of float textures, so the work can be split
 * into short passes that don't stall the browser.
 */
export class IterationTarget {
  private readonly textures: [WebGLTexture, WebGLTexture][];
  private readonly framebuffers: WebGLFramebuffer[];
  private readonly reductions: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }[] = [];
  private current = 0;
  private params: IterationParams | null = null;
  private needsReset = true;
  /** Iterations every running pixel has done so far. */
  iterations = 0;

  constructor(
    private readonly renderer: Renderer,
    readonly width: number,
    readonly height: number,
  ) {
    const { gl } = renderer;
    this.textures = [0, 1].map(() => [
      createTexture(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST),
      createTexture(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST),
    ]) as [WebGLTexture, WebGLTexture][];
    this.framebuffers = this.textures.map(([state0, state1]) => {
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, state1, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      return framebuffer;
    });
    // A chain of textures, each 8 times smaller, down to a single pixel.
    let w = width;
    let h = height;
    do {
      w = Math.ceil(w / 8);
      h = Math.ceil(h / 8);
      const texture = createTexture(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      this.reductions.push({ texture, framebuffer, width: w, height: h });
    } while (w > 1 || h > 1);
  }

  get state1(): WebGLTexture {
    return this.textures[this.current][1];
  }

  /** Starts over with new parameters. The pixels reset on the next step. */
  begin(params: IterationParams): void {
    this.params = params;
    this.needsReset = true;
    this.iterations = 0;
  }

  step(steps: number): void {
    if (!this.params) throw new Error('Call begin() before step().');
    const next = 1 - this.current;
    this.renderer.runIterate(this, this.params, steps, this.needsReset, this.textures[this.current], this.framebuffers[next]);
    this.current = next;
    this.needsReset = false;
    this.iterations += steps;
  }

  /** Reduces the state to a min/max and running count, and reads it back. */
  reduce(): Reduction {
    const { gl } = this.renderer;
    let input = this.state1;
    let inputWidth = this.width;
    let inputHeight = this.height;
    this.reductions.forEach((level, index) => {
      this.renderer.runReduce(input, inputWidth, inputHeight, index === 0, level.framebuffer, level.width, level.height);
      input = level.texture;
      inputWidth = level.width;
      inputHeight = level.height;
    });
    const result = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, result);
    // The shader starts from ±1e30, which is what comes back while no pixel has escaped.
    const escaped = result[0] <= result[1];
    return { min: escaped ? result[0] : Infinity, max: escaped ? result[1] : -Infinity, running: result[2] };
  }

  /** Reads state 1 (n, status, smooth n, 0) of every pixel, bottom row first. */
  readState(): Float32Array {
    const { gl } = this.renderer;
    const framebuffer = this.framebuffers[this.current];
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    const data = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, data);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    return data;
  }

  dispose(): void {
    const { gl } = this.renderer;
    this.textures.flat().forEach((texture) => gl.deleteTexture(texture));
    this.framebuffers.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
    this.reductions.forEach(({ texture, framebuffer }) => {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
    });
  }
}

/**
 * The color scale: t = (log(n - offset) - low) * scale, a log scale from the
 * lowest to the highest count like matplotlib's LogNorm. Deep views have
 * counts like 5000 to 18000, which a plain log scale squeezes into a few
 * colors, so the scale starts at 50 below the lowest count. Views whose
 * lowest count is under 50, like the overview, keep the plain log scale.
 */
export function logRange({ min, max }: ColorRange): [number, number, number] {
  if (!(min <= max)) return [0, 0, 0];
  const offset = Math.max(0, min - 50);
  const low = Math.log(Math.max(min - offset, 1));
  const high = Math.log(Math.max(max - offset, 1));
  return [offset, low, high > low ? 1 / (high - low) : 0];
}

/** Splits a double into two floats whose sum is the double to about 48 bits. */
function splitDouble(value: number): [number, number] {
  const hi = Math.fround(value);
  return [hi, Math.fround(value - hi)];
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource: string): Program {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, fullscreenVertex],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader failed to compile:\n${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader program failed to link:\n${gl.getProgramInfoLog(program)}`);
  }
  const uniforms: Uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(program, i)!.name;
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
  filter: number,
): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  return texture;
}

function setNearest(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function bindTexture(gl: WebGL2RenderingContext, unit: number, texture: WebGLTexture, location: WebGLUniformLocation | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(location, unit);
}
