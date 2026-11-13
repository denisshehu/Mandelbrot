import { bigIntToFloat } from '../math/fixed';
import type { View } from '../math/view';
import { buildLookupTable, findColormap } from './colormaps';
import {
  canReuseReference,
  iterationsFor,
  pixelGeometry,
  type Reference,
  referenceView,
  type Settings,
} from './frame';
import { CancelledError, OrbitClient } from './orbit-client';
import { type ColorRange, type Image, type IterationTarget, type Reduction, Renderer } from './renderer';

export interface Status {
  view: View;
  maxIterations: number;
  /** Share of the pixels that are finished, from 0 to 1. */
  progress: number;
  done: boolean;
  computingReference: boolean;
  /** Milliseconds since the frame started. */
  elapsed: number;
}

/** What one frame on screen was rendered with, to map it onto the next one. */
interface Frame {
  view: View;
  logicalWidth: number;
  logicalHeight: number;
  maxIterations: number;
  started: number;
  done: boolean;
  /** Whether the iterate pass has been set up with a reference for this frame. */
  iterating: boolean;
  /** Whether the frame jumped somewhere the previous one doesn't show, like a preset. */
  jump: boolean;
}

/** GPU time to aim for per animation frame, so the page stays responsive. */
const TARGET_PASS_MS = 14;

/** How long the colors take to ease onto the exact range once a frame is done. */
const SETTLE_MS = 250;

/**
 * After a jump the previous image would be stretched beyond recognition, so it
 * stays as it was, darkened, until the first new pixels arrive. Then it goes,
 * since it has nothing to do with the new view, and the rest fills in from
 * black like the first frame.
 */
const JUMP_DIM = 0.4;

/**
 * Renders the view to the canvas, progressively: each animation frame advances
 * every pixel by as many iterations as fit in the time budget. While a frame
 * is still rendering, unfinished pixels show the previous frame.
 *
 * The color scale runs from the lowest to the highest iteration count, but the
 * highest is only known once the slowest pixels escape. Rescaling after every
 * pass would sweep the colors across the image, so a frame keeps the highest
 * count of the image on screen, or the iteration limit after a jump, until
 * it's done, then eases onto the exact range.
 */
export class Explorer {
  readonly renderer: Renderer;
  private readonly orbits = new OrbitClient();
  private reference: Reference | null = null;
  private target: IterationTarget | null = null;
  private display: Image | null = null;
  private previous: { image: Image; frame: Frame } | null = null;
  private frame: Frame | null = null;
  private reduction: Reduction = emptyReduction(0);
  /** The range the image on screen is colored with. */
  private range: ColorRange | null = null;
  private settling: { from: ColorRange; to: ColorRange; started: number } | null = null;
  /** Measured pixel-iterations per millisecond, to size the passes. */
  private rate = 20_000;
  private animation = 0;
  private needsRestart = true;
  private suspended = false;
  private computingReference = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private view: View,
    private settings: Settings,
    private readonly onStatus: (status: Status) => void,
  ) {
    this.renderer = new Renderer(canvas);
    this.renderer.setColormap(buildLookupTable(findColormap(settings.colormap)));
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  getView(): View {
    return this.view;
  }

  getSettings(): Settings {
    return this.settings;
  }

  /** The current reference orbit, which an export can reuse. */
  getReference(): Reference | null {
    return this.reference;
  }

  setView(view: View): void {
    if (view.equals(this.view)) return;
    this.view = view;
    this.restart();
  }

  setSettings(settings: Settings): void {
    const previous = this.settings;
    this.settings = settings;
    if (settings.colormap !== previous.colormap) {
      this.renderer.setColormap(buildLookupTable(findColormap(settings.colormap)));
    }
    const needsRender =
      settings.maxIterations !== previous.maxIterations ||
      settings.autoIterations !== previous.autoIterations ||
      settings.escapeRadius !== previous.escapeRadius ||
      settings.cellSize !== previous.cellSize;
    if (needsRender) this.restart();
    else this.schedule();
  }

  /** The canvas width in CSS pixels, which pointer events are measured in. */
  get cssWidth(): number {
    return this.canvas.clientWidth;
  }

  /** Stops rendering, for example while an export uses the GPU. */
  suspend(): void {
    this.suspended = true;
    cancelAnimationFrame(this.animation);
    this.animation = 0;
  }

  resume(): void {
    this.suspended = false;
    // The export replaced the orbit texture, so the reference has to be uploaded again.
    if (this.reference) this.renderer.setOrbit(this.reference.points, this.reference.length);
    this.restart();
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.restart();
  }

  private restart(): void {
    this.needsRestart = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.suspended || this.animation) return;
    this.animation = requestAnimationFrame(() => {
      this.animation = 0;
      this.tick();
    });
  }

  private tick(): void {
    if (this.needsRestart) {
      this.needsRestart = false;
      this.startFrame();
    }
    const frame = this.frame;
    const target = this.target;
    if (!frame || !target || !this.display) return;

    if (frame.iterating && !frame.done) {
      const remaining = frame.maxIterations + 1 - target.iterations;
      const running = Math.max(1, this.reduction.running || target.width * target.height);
      const steps = Math.max(1, Math.min(remaining, Math.floor((this.rate * TARGET_PASS_MS) / running)));
      const start = performance.now();
      target.step(steps);
      this.reduction = target.reduce();
      const elapsed = Math.max(0.5, performance.now() - start);
      // Smooth the estimate, but drop it fast after a slow pass.
      const measured = (running * steps) / elapsed;
      this.rate = elapsed > 3 * TARGET_PASS_MS ? measured : 0.7 * this.rate + 0.3 * measured;
      frame.done = this.reduction.running === 0 || target.iterations > frame.maxIterations;
      if (frame.done && this.range) {
        this.settling = { from: this.range, to: this.reduction, started: performance.now() };
      }
    }

    const range = this.colorRange(frame);
    const previous = this.previous;
    const transform: [number, number, number] = !previous
      ? [1, 0, 0]
      : frame.jump
        ? [previous.frame.logicalWidth / frame.logicalWidth, 0, 0]
        : previousTransform(previous.frame, frame);
    const backdrop = frame.jump && Number.isFinite(this.reduction.min) ? null : (previous?.image ?? null);
    this.renderer.colorize(target, range, this.display, backdrop, transform, frame.jump ? JUMP_DIM : 1);
    this.renderer.present(this.display, this.settings.cellSize);
    this.emitStatus();
    if (!frame.done || this.settling) this.schedule();
  }

  private colorRange(frame: Frame): ColorRange {
    const { min, max } = this.reduction;
    if (!frame.done) {
      // The lowest count is exact as soon as any pixel escapes, since all
      // pixels advance together. Pixels above the estimate get the last color.
      const shown = this.range ?? { min, max: frame.maxIterations };
      return (this.range = {
        min: Number.isFinite(min) ? min : shown.min,
        max: Math.min(shown.max, frame.maxIterations),
      });
    }
    const settling = this.settling;
    if (!settling) return (this.range = { min, max });
    const t = Math.min(1, (performance.now() - settling.started) / SETTLE_MS);
    if (t === 1 || !Number.isFinite(settling.from.min + settling.from.max)) {
      this.settling = null;
      return (this.range = settling.to);
    }
    const eased = t * (2 - t);
    const mix = (a: number, b: number) => a + (b - a) * eased;
    return (this.range = {
      min: mix(settling.from.min, settling.to.min),
      max: mix(settling.from.max, settling.to.max),
    });
  }

  private startFrame(): void {
    const { renderer, settings, view } = this;
    const cellSize = settings.cellSize;
    const logicalWidth = this.canvas.width / cellSize;
    const logicalHeight = this.canvas.height / cellSize;
    const width = Math.ceil(logicalWidth);
    const height = Math.ceil(logicalHeight);

    if (!this.target || this.target.width !== width || this.target.height !== height) {
      this.target?.dispose();
      this.target = renderer.createTarget(width, height);
    }

    // What's on screen now becomes the backdrop for the new frame.
    if (this.display && this.frame) {
      const reused = this.previous?.image;
      this.previous = { image: this.display, frame: this.frame };
      this.display = reused && reused.width === width && reused.height === height ? reused : null;
      if (reused && !this.display) renderer.deleteImage(reused);
    } else if (this.display && (this.display.width !== width || this.display.height !== height)) {
      renderer.deleteImage(this.display);
      this.display = null;
    }
    this.display ??= renderer.createImage(width, height);

    const maxIterations = iterationsFor(settings, view);
    const frame: Frame = {
      view,
      logicalWidth,
      logicalHeight,
      maxIterations,
      started: performance.now(),
      done: false,
      iterating: false,
      jump: this.previous !== null && !overlaps(this.previous.frame, { view, logicalWidth, logicalHeight }),
    };
    this.frame = frame;
    this.reduction = emptyReduction(width * height);
    this.settling = null;
    // Most views have pixels that escape just before the limit, so after a jump
    // the limit is a better guess for the highest count than the old view's.
    if (!this.previous || frame.jump || !Number.isFinite(this.range?.max ?? NaN)) {
      this.range = null;
    }

    // Clear the state so the first draws show only the previous frame.
    this.target.begin(this.iterationParams(frame, null));
    this.target.step(0);

    const reference = this.reference;
    if (reference && canReuseReference(reference, view, logicalWidth, maxIterations, settings.escapeRadius)) {
      this.orbits.cancel();
      this.computingReference = false;
      this.beginIterating(frame, reference);
      return;
    }

    this.requestReference(view, maxIterations, (reference) => {
      if (this.frame !== frame) return;
      this.beginIterating(frame, reference);
      this.schedule();
    });
  }

  /** Computes a reference orbit at `point` in the worker and makes it current. */
  private requestReference(point: View, maxIterations: number, then: (reference: Reference) => void): void {
    const { settings } = this;
    this.computingReference = true;
    const request = {
      x: point.x,
      y: point.y,
      bits: point.bits,
      // Headroom, so small zoom changes with automatic iterations keep the orbit.
      maxIterations: settings.autoIterations ? Math.ceil(maxIterations * 1.5) : maxIterations,
      escapeRadius: settings.escapeRadius,
    };
    this.orbits.compute(request).then(
      (result) => {
        this.computingReference = false;
        this.reference = { ...result, ...request };
        this.renderer.setOrbit(result.points, result.length);
        then(this.reference);
      },
      (error: unknown) => {
        if (!(error instanceof CancelledError)) console.error(error);
      },
    );
  }

  private beginIterating(frame: Frame, reference: Reference): void {
    this.target!.begin(this.iterationParams(frame, reference));
    frame.iterating = true;
  }

  private iterationParams(frame: Frame, reference: Reference | null) {
    const { exponent, pixelScale } = pixelGeometry(frame.view.log2Width, frame.logicalWidth);
    const [rx, ry] = reference
      ? frame.view.offsetInPixels(referenceView(reference, frame.view), frame.logicalWidth)
      : [0, 0];
    const width = frame.view.width;
    return {
      maxIterations: frame.maxIterations,
      escapeRadius: this.settings.escapeRadius,
      origin: [-frame.logicalWidth / 2 - rx, -frame.logicalHeight / 2 - ry] as [number, number],
      pixelScale,
      exponent,
      reference: reference
        ? ([bigIntToFloat(reference.x, -reference.bits), bigIntToFloat(reference.y, -reference.bits)] as [number, number])
        : ([0, 0] as [number, number]),
      // Only exact enough while pixels are much larger than float precision.
      skipBulbs: reference !== null && width > 1e-3,
    };
  }

  private emitStatus(): void {
    const frame = this.frame!;
    const total = this.target!.width * this.target!.height;
    this.onStatus({
      view: frame.view,
      maxIterations: frame.maxIterations,
      progress: frame.done ? 1 : frame.iterating ? 1 - this.reduction.running / total : 0,
      done: frame.done,
      computingReference: this.computingReference,
      elapsed: performance.now() - frame.started,
    });
  }
}

function emptyReduction(running: number): Reduction {
  return { min: Infinity, max: -Infinity, running };
}

/** Whether the new frame shows part of the previous one, at a similar scale. */
function overlaps(previous: Frame, next: Pick<Frame, 'view' | 'logicalWidth' | 'logicalHeight'>): boolean {
  const [scale, x, y] = previousTransform(previous, next);
  if (scale < 1 / 16 || scale > 16) return false;
  return (
    x < previous.logicalWidth &&
    x + next.logicalWidth * scale > 0 &&
    y < previous.logicalHeight &&
    y + next.logicalHeight * scale > 0
  );
}

/** Maps a pixel of the new frame to the matching pixel of the previous one. */
function previousTransform(
  previous: Frame,
  next: Pick<Frame, 'view' | 'logicalWidth' | 'logicalHeight'>,
): [number, number, number] {
  const scale =
    2 ** (next.view.log2Width - previous.view.log2Width) * (previous.logicalWidth / next.logicalWidth);
  const [ox, oy] = previous.view.offsetInPixels(next.view, previous.logicalWidth);
  return [
    scale,
    previous.logicalWidth / 2 + ox - (next.logicalWidth / 2) * scale,
    previous.logicalHeight / 2 + oy - (next.logicalHeight / 2) * scale,
  ];
}
