import { exportPng } from './export/export';
import { parseDecimal } from './math/fixed';
import { LOG10_2, log2OfDecimal, MIN_LOG2_WIDTH, View } from './math/view';
import { fitView, presets, type Preset } from './presets';
import { buildLookupTable, COLORMAP_SIZE, colormaps, cssGradient, findColormap } from './render/colormaps';
import { Explorer, type Status } from './render/explorer';
import { defaultSettings, MAX_ITERATIONS, type Settings } from './render/frame';
import { readHash, writeHash } from './ui/hash';
import { attachInput } from './ui/input';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = element<HTMLCanvasElement>('canvas');
const fields = {
  x: element<HTMLInputElement>('center-x'),
  y: element<HTMLInputElement>('center-y'),
  width: element<HTMLInputElement>('plane-width'),
  iterations: element<HTMLInputElement>('iterations'),
  autoIterations: element<HTMLInputElement>('auto-iterations'),
  escapeRadius: element<HTMLInputElement>('escape-radius'),
  customWidth: element<HTMLInputElement>('custom-width'),
  customHeight: element<HTMLInputElement>('custom-height'),
};
const resetView = element<HTMLButtonElement>('reset-view');
const resetRendering = element<HTMLButtonElement>('rendering-reset');

let explorer: Explorer;
/** Whether the view is the fitted starting view, which follows the window size. */
let atHome = false;

function start(): void {
  const initial = readHash(location.hash);
  const view = initial.view ?? home();
  const settings: Settings = { ...defaultSettings, ...initial.settings };

  try {
    explorer = new Explorer(canvas, view, settings, onStatus);
  } catch (error) {
    const fatal = element('fatal');
    fatal.textContent = `${(error as Error).message} Please use a recent version of Chrome, Edge, Firefox or Safari.`;
    fatal.hidden = false;
    return;
  }
  navigate(view);

  attachInput(canvas, () => explorer.getView(), navigate);
  const closePopover = setUpDock();
  setUpPresets(closePopover);
  setUpLocation();
  setUpColors();
  setUpRendering();
  setUpExport();
  setUpTips();
  element('slow-notice').addEventListener('pointerleave', updateSlowNotice);
  showView(view);
  showSettings(settings);

  resetView.addEventListener('click', () => navigate(home()));
  window.addEventListener('resize', () => {
    if (atHome) navigate(home());
  });
  // A link pasted into a tab that already shows the site only changes the hash.
  window.addEventListener('hashchange', () => {
    const next = readHash(location.hash);
    const nextSettings: Settings = { ...defaultSettings, ...next.settings };
    showSettings(nextSettings);
    explorer.setSettings(nextSettings);
    navigate(next.view ?? home());
  });
}

function home(): View {
  return viewOf(presets[0]);
}

/** Shows `view`, and offers to go back to the start whenever it's somewhere else. */
function navigate(view: View): void {
  atHome = view.equals(home());
  resetView.hidden = atHome;
  explorer.setView(view);
}

function viewOf(preset: Preset): View {
  return fitView(preset, canvas.clientWidth, canvas.clientHeight);
}

/**
 * Renders under about a second feel immediate, and most views here take less.
 * Past 2 seconds a notice shows, and its "i" explains how to make the view
 * faster and what that costs.
 */
const SLOW_RENDER_MS = 2000;
let slowRendering = false;

/**
 * Shows the slow-render notice while a slow render runs. Once it's done, the
 * notice stays as long as the pointer is on it or its explanation is open.
 */
function updateSlowNotice(): void {
  const slow = element('slow-notice');
  const explaining = !element('tip').hidden && tipOwner !== null && slow.contains(tipOwner);
  if (slowRendering) slow.hidden = false;
  else if (!slow.matches(':hover') && !explaining) slow.hidden = true;
}

function onStatus(status: Status): void {
  element('hud-zoom').textContent = formatZoom(status.view.log2Width);
  element('hud-iterations').textContent = status.maxIterations.toLocaleString('en-US');
  // Deep views finish no pixels for a while, so the share only shows once it moves.
  element('hud-progress').textContent = status.done
    ? formatSeconds(status.elapsed)
    : status.progress >= 0.01
      ? `${Math.floor(status.progress * 100)}%`
      : '';
  element('hud-spinner').hidden = status.done;
  element('notice').hidden = status.view.log2Width > MIN_LOG2_WIDTH;
  slowRendering = !status.done && status.elapsed >= SLOW_RENDER_MS;
  updateSlowNotice();
  showView(status.view);
  if (fields.autoIterations.checked && document.activeElement !== fields.iterations) {
    fields.iterations.value = String(status.maxIterations);
  }
  if (status.done) writeHash(status.view, currentSettings());
}

let lastStatusView: View | null = null;
const presetButtons: HTMLButtonElement[] = [];

function showView(view: View): void {
  if (lastStatusView === view) return;
  lastStatusView = view;
  const text = view.toStrings();
  for (const key of ['x', 'y', 'width'] as const) {
    if (document.activeElement !== fields[key]) fields[key].value = text[key];
  }
  markCurrentPreset(view);
}

/** Marks the preset showing right now, until the view moves away from it. */
function markCurrentPreset(view: View): void {
  presets.forEach((preset, index) => {
    presetButtons[index]?.setAttribute('aria-current', String(view.equals(viewOf(preset))));
  });
}

function showSettings(settings: Settings): void {
  fields.iterations.value = String(settings.maxIterations);
  fields.autoIterations.checked = settings.autoIterations;
  fields.escapeRadius.value = String(settings.escapeRadius);
  check('cell-size', String(settings.cellSize));
  check('colormap', settings.colormap);
  paintThumbnails(settings.colormap);
  updateResetRendering();
}

function currentSettings(): Settings {
  return {
    maxIterations: clampInteger(fields.iterations.valueAsNumber, 10, MAX_ITERATIONS, defaultSettings.maxIterations),
    autoIterations: fields.autoIterations.checked,
    escapeRadius: clampInteger(fields.escapeRadius.valueAsNumber, 2, 100_000, defaultSettings.escapeRadius),
    colormap: checked('colormap') ?? defaultSettings.colormap,
    cellSize: Number(checked('cell-size')) || 1,
  };
}

/** The value of the checked radio button in a group. */
function checked(name: string): string | undefined {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value;
}

function check(name: string, value: string): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}

function apply(): void {
  const settings = currentSettings();
  explorer.setSettings(settings);
  writeHash(explorer.getView(), settings);
  updateResetRendering();
}

function setUpPresets(closePopover: () => void): void {
  const container = element('presets');
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.innerHTML = `<canvas aria-hidden="true"></canvas><span>${preset.name}</span>`;
    loadThumbnail(preset.id, button.querySelector('canvas')!);
    button.addEventListener('click', () => {
      if (preset.maxIterations) {
        fields.autoIterations.checked = false;
        fields.iterations.value = String(preset.maxIterations);
      } else {
        fields.autoIterations.checked = true;
      }
      apply();
      navigate(viewOf(preset));
      closePopover();
    });
    presetButtons.push(button);
    container.append(button);
  }
  markCurrentPreset(explorer.getView());
}

interface Thumbnail {
  canvas: HTMLCanvasElement;
  /** Position of each pixel on the color scale, from 0 to 255, as stored in the gray image. */
  levels: Uint8Array;
}

// The preset images are stored as gray levels instead of colors, so they can be
// painted with whichever colormap is selected, the same way the set is.
const thumbnails: Thumbnail[] = [];
let thumbnailTable: Uint8Array | null = null;
let thumbnailColormap = '';

async function loadThumbnail(id: string, canvas: HTMLCanvasElement): Promise<void> {
  const image = new Image();
  image.src = `./presets/${id}.png`;
  await image.decode();
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const levels = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < levels.length; i++) levels[i] = rgba[i * 4];
  const thumbnail = { canvas, levels };
  thumbnails.push(thumbnail);
  if (thumbnailTable) paintThumbnail(thumbnail, thumbnailTable);
}

function paintThumbnails(colormap: string): void {
  if (colormap === thumbnailColormap) return;
  thumbnailColormap = colormap;
  thumbnailTable = buildLookupTable(findColormap(colormap));
  for (const thumbnail of thumbnails) paintThumbnail(thumbnail, thumbnailTable);
}

function paintThumbnail({ canvas, levels }: Thumbnail, table: Uint8Array): void {
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < levels.length; i++) {
    const entry = Math.round((levels[i] / 255) * (COLORMAP_SIZE - 1)) * 4;
    image.data.set(table.subarray(entry, entry + 4), i * 4);
  }
  context.putImageData(image, 0, 0);
}

/** Text that can still become a center as you type, like "-", "1e" or "1+". */
const CENTER_PREFIX = /^\s*[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*[+-]\s*)*(?:\d+\.?\d*(?:e[+-]?\d*)?|\.\d*)?\s*$/i;
/** Text that can still become a width as you type, like "0." on the way to "0.01". */
const WIDTH_PREFIX = /^\s*\+?(?:\d+\.?\d*(?:e[+-]?\d*)?|\.\d*)?\s*$/i;
/** How long to wait after the last keystroke before calling unfinished text an error. */
const TYPING_PAUSE_MS = 800;

interface FieldCheck {
  input: HTMLInputElement;
  isValid: (text: string) => boolean;
  /** Whether more typing could still make the text valid. */
  couldBecomeValid: (text: string) => boolean;
  message: string;
}

function setUpLocation(): void {
  const form = element<HTMLFormElement>('location-form');
  const succeeds = (parse: (text: string) => unknown) => (text: string) => {
    try {
      parse(text);
      return true;
    } catch {
      return false;
    }
  };
  // Each field is checked on its own, so the message shows under the one that's wrong.
  const center = (input: HTMLInputElement): FieldCheck => ({
    input,
    isValid: succeeds((text) => parseDecimal(text, 64)),
    couldBecomeValid: (text) => CENTER_PREFIX.test(text),
    message: 'Enter a valid number',
  });
  const checks: FieldCheck[] = [
    center(fields.x),
    center(fields.y),
    {
      input: fields.width,
      isValid: succeeds(log2OfDecimal),
      couldBecomeValid: (text) => WIDTH_PREFIX.test(text),
      message: 'Enter a positive number',
    },
  ];

  // Text that can never be valid shows its error right away. Unfinished text,
  // like "-" on the way to "-0.5", only after a pause or when leaving the field.
  for (const check of checks) {
    let timer = 0;
    const validate = () => {
      clearTimeout(timer);
      const text = check.input.value;
      showFieldError(check.input, text.trim() && !check.isValid(text) ? check.message : null);
    };
    check.input.addEventListener('input', () => {
      clearTimeout(timer);
      const text = check.input.value;
      if (!text.trim() || check.isValid(text)) {
        showFieldError(check.input, null);
      } else if (!check.couldBecomeValid(text)) {
        showFieldError(check.input, check.message);
      } else {
        showFieldError(check.input, null);
        timer = window.setTimeout(validate, TYPING_PAUSE_MS);
      }
    });
    check.input.addEventListener('blur', validate);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let valid = true;
    for (const { input, isValid, message } of checks) {
      const ok = isValid(input.value);
      showFieldError(input, ok ? null : message);
      valid &&= ok;
    }
    if (!valid) return;
    (document.activeElement as HTMLElement | null)?.blur();
    lastStatusView = null;
    navigate(View.fromStrings(fields.x.value, fields.y.value, fields.width.value));
  });

  const copy = element<HTMLButtonElement>('copy-link');
  copy.addEventListener('click', async () => {
    writeHash(explorer.getView(), explorer.getSettings());
    try {
      await navigator.clipboard.writeText(location.href);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Could not copy';
    }
    setTimeout(() => (copy.textContent = 'Copy link'), 1500);
  });
}

function showFieldError(input: HTMLInputElement, message: string | null): void {
  const error = element(`${input.id}-error`);
  input.setAttribute('aria-invalid', String(message !== null));
  error.textContent = message ?? '';
  error.hidden = message === null;
}

function setUpColors(): void {
  const container = element('colormaps');
  for (const colormap of colormaps) {
    const label = document.createElement('label');
    label.className = 'colormap';
    label.innerHTML = `<input type="radio" name="colormap" value="${colormap.id}" /><span><span class="swatch"></span>${colormap.name}</span>`;
    label.querySelector<HTMLElement>('.swatch')!.style.background = cssGradient(colormap);
    container.append(label);
  }
  container.addEventListener('change', () => {
    apply();
    paintThumbnails(currentSettings().colormap);
  });
}

function setUpRendering(): void {
  fields.iterations.addEventListener('change', () => {
    fields.autoIterations.checked = false;
    apply();
  });
  fields.autoIterations.addEventListener('change', apply);
  fields.escapeRadius.addEventListener('change', apply);
  element('rendering-popover').addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name === 'cell-size') apply();
  });
  resetRendering.addEventListener('click', () => {
    const { colormap } = currentSettings();
    showSettings({ ...defaultSettings, colormap });
    apply();
  });
}

/** Disables the reset button of the Rendering pop-up while nothing differs from the defaults. */
function updateResetRendering(): void {
  const settings = currentSettings();
  resetRendering.disabled =
    settings.autoIterations === defaultSettings.autoIterations &&
    settings.escapeRadius === defaultSettings.escapeRadius &&
    settings.cellSize === defaultSettings.cellSize;
}

function setUpExport(): void {
  const button = element<HTMLButtonElement>('export');
  const cancel = element<HTMLButtonElement>('export-cancel');
  const progress = element('export-progress');
  const bar = element('export-bar');
  const label = element('export-label');
  const custom = element('custom-size');
  let controller: AbortController | null = null;

  element('download-popover').addEventListener('change', () => {
    custom.hidden = checked('resolution') !== 'custom';
  });
  cancel.addEventListener('click', () => controller?.abort());

  button.addEventListener('click', async () => {
    const [width, height] = exportSize();
    controller = new AbortController();
    // Cancel takes the place of the main button while the download runs.
    const hadFocus = document.activeElement === button;
    button.hidden = true;
    cancel.hidden = false;
    if (hadFocus) cancel.focus();
    progress.hidden = false;
    progress.classList.remove('failed');
    const started = performance.now();
    try {
      const blob = await exportPng(
        explorer,
        { width, height, view: explorer.getView(), settings: explorer.getSettings() },
        (fraction, text) => {
          bar.style.width = `${(fraction * 100).toFixed(1)}%`;
          label.textContent = `${text}, ${Math.floor(fraction * 100)}%`;
        },
        controller.signal,
      );
      download(blob, `mandelbrot-${width}x${height}.png`);
      label.textContent = `Completed in ${formatSeconds(performance.now() - started)} (${(blob.size / 1e6).toFixed(1)} MB)`;
    } catch (error) {
      const cancelled = (error as Error).name === 'AbortError';
      progress.classList.toggle('failed', !cancelled);
      label.textContent = cancelled ? 'Download canceled' : `Download failed: ${(error as Error).message}`;
    } finally {
      const cancelHadFocus = document.activeElement === cancel;
      button.hidden = false;
      cancel.hidden = true;
      if (cancelHadFocus) button.focus();
      controller = null;
    }
  });
}

function exportSize(): [number, number] {
  const value = checked('resolution') ?? '3840x2160';
  if (value === 'screen') return [canvas.width, canvas.height];
  if (value === 'custom') {
    return [
      clampInteger(fields.customWidth.valueAsNumber, 16, 16384, 3840),
      clampInteger(fields.customHeight.valueAsNumber, 16, 16384, 2160),
    ];
  }
  const [width, height] = value.split('x').map(Number);
  return [width, height];
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Opens the pop-up of a round button above it, one at a time. Escape, the
 * same button or a click on the set closes it, but dragging and zooming
 * don't, so the settings stay open while you explore. Returns a function
 * that closes the open pop-up.
 */
function setUpDock(): () => void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.dock button[aria-controls]')];
  const popoverOf = (button: HTMLButtonElement) => element(button.getAttribute('aria-controls')!);
  let open: HTMLButtonElement | null = null;

  const place = () => {
    if (!open) return;
    const popover = popoverOf(open);
    const button = open.getBoundingClientRect();
    const margin = 16;
    const left = button.left + button.width / 2 - popover.offsetWidth / 2;
    const max = window.innerWidth - margin - popover.offsetWidth;
    popover.style.setProperty('--popover-left', `${Math.max(margin, Math.min(max, left))}px`);
  };
  const close = () => {
    if (!open) return;
    open.setAttribute('aria-expanded', 'false');
    popoverOf(open).hidden = true;
    open = null;
    hideTip();
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const wasOpen = open === button;
      close();
      if (wasOpen) return;
      open = button;
      button.setAttribute('aria-expanded', 'true');
      popoverOf(button).hidden = false;
      place();
    });
  }
  window.addEventListener('resize', place);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => (down = { x: event.clientX, y: event.clientY }));
  canvas.addEventListener('pointerup', (event) => {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) close();
    down = null;
  });
  return close;
}

/**
 * Shows the text of an "i" button on hover, focus or tap. The tooltip
 * stays open while the pointer is on it, so a link inside it can be clicked.
 */
function setUpTips(): void {
  const tip = element('tip');
  let pointerInTip = false;
  const keep = () => {
    pointerInTip = true;
    clearTimeout(tipTimer);
  };
  tip.addEventListener('pointerenter', keep);
  tip.addEventListener('pointerdown', keep);
  tip.addEventListener('pointerleave', () => {
    pointerInTip = false;
    hideTipSoon();
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('.info')) {
    const show = () => {
      clearTimeout(tipTimer);
      showTip(button);
    };
    button.addEventListener('pointerenter', show);
    button.addEventListener('focus', show);
    button.addEventListener('click', show);
    button.addEventListener('pointerleave', hideTipSoon);
    button.addEventListener('blur', hideTipSoon);
  }

  // Long enough to move the pointer across the gap onto the tooltip.
  function hideTipSoon(): void {
    clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      if (!pointerInTip && document.activeElement !== tipOwner) hideTip();
    }, 200);
  }
}

let tipTimer = 0;
let tipOwner: HTMLButtonElement | null = null;

function showTip(button: HTMLButtonElement): void {
  const tip = element('tip');
  tipOwner = button;
  const text = button.dataset.tip ?? '';
  const linkText = button.dataset.tipLink;
  const opens = button.dataset.tipOpens;
  tip.replaceChildren();
  if (linkText && opens && text.includes(linkText)) {
    const [before, after] = text.split(linkText);
    // A link rather than a button, so it wraps with the sentence around it.
    const link = document.createElement('a');
    link.href = `#${opens}`;
    link.className = 'tip-link';
    link.textContent = linkText;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      hideTip();
      openPopover(opens);
    });
    tip.append(before, link, after);
  } else {
    tip.textContent = text;
  }
  tip.hidden = false;
  const rect = button.getBoundingClientRect();
  // Measure from the drawn circle, which sits inside the button's larger hit
  // area, or inside a notice from the whole pill.
  const notice = button.closest('.notice');
  const inset = notice ? 0 : -parseFloat(getComputedStyle(button).marginTop) || 0;
  const box = (notice ?? button).getBoundingClientRect();
  const edges = { top: box.top + inset, bottom: box.bottom - inset };
  const margin = 8;
  // The same spacing as between every other floating element.
  const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 8;
  // Exact sizes, since offsetWidth and offsetHeight round to whole pixels.
  const size = tip.getBoundingClientRect();
  const left = rect.left + rect.width / 2 - size.width / 2;
  const above = edges.top - size.height - gap;
  tip.style.left = `${Math.max(margin, Math.min(window.innerWidth - margin - size.width, left))}px`;
  tip.style.top = `${above >= margin ? above : edges.bottom + gap}px`;
}

function hideTip(): void {
  clearTimeout(tipTimer);
  tipOwner = null;
  element('tip').hidden = true;
  updateSlowNotice();
}

/** Opens a pop-up as if its round button was clicked, unless it's open already. */
function openPopover(id: string): void {
  const button = document.querySelector<HTMLButtonElement>(`.dock [aria-controls="${id}"]`)!;
  if (button.getAttribute('aria-expanded') !== 'true') button.click();
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** How far the view is zoomed in from the starting view, like "250×" or "1.1e36×". */
function formatZoom(log2Width: number): string {
  const log10 = (home().log2Width - log2Width) * LOG10_2;
  if (log10 < 4) return `${Number((10 ** log10).toPrecision(3))}×`;
  const exponent = Math.floor(log10);
  return `${(10 ** (log10 - exponent)).toFixed(1)}e${exponent}×`;
}

function formatSeconds(milliseconds: number): string {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

start();
