import type { View } from '../math/view';

/**
 * Turns mouse, touch and keyboard input on the canvas into view changes:
 * drag to pan, wheel or pinch to zoom at the pointer, double-click to zoom in
 * (with Shift to zoom out), and arrow keys or +/- when nothing else has focus.
 */
export function attachInput(canvas: HTMLCanvasElement, getView: () => View, setView: (view: View) => void): void {
  const pointers = new Map<number, { x: number; y: number }>();
  const zoom = (view: View, factor: number, px: number, py: number) => view.zoomAt(factor, px, py, width());

  /** Pointer position relative to the canvas center, with y pointing up like the plane. */
  const offset = (clientX: number, clientY: number): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [clientX - rect.left - rect.width / 2, rect.top + rect.height / 2 - clientY];
  };
  const width = () => canvas.clientWidth;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const next = { x: event.clientX, y: event.clientY };
    if (pointers.size === 1) {
      setView(getView().pan(last.x - next.x, next.y - last.y, width()));
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      // Zoom around the midpoint, then follow the midpoint as it moves.
      const [mx, my] = offset((last.x + other.x) / 2, (last.y + other.y) / 2);
      let view = getView();
      if (before > 0 && after > 0) view = zoom(view, after / before, mx, my);
      view = view.pan((last.x - next.x) / 2, (next.y - last.y) / 2, width());
      setView(view);
    }
    pointers.set(event.pointerId, next);
  });

  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
      // Pinch gestures on trackpads arrive as wheel events with ctrlKey.
      const speed = event.ctrlKey ? 0.01 : 0.002;
      const factor = 2 ** (-event.deltaY * lines * speed);
      setView(zoom(getView(), factor, ...offset(event.clientX, event.clientY)));
    },
    { passive: false },
  );

  canvas.addEventListener('dblclick', (event) => {
    setView(zoom(getView(), event.shiftKey ? 0.5 : 2, ...offset(event.clientX, event.clientY)));
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, select, textarea') || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = width() * 0.1;
    const actions: Record<string, () => View> = {
      ArrowLeft: () => getView().pan(-step, 0, width()),
      ArrowRight: () => getView().pan(step, 0, width()),
      ArrowUp: () => getView().pan(0, step, width()),
      ArrowDown: () => getView().pan(0, -step, width()),
      '+': () => zoom(getView(), 1.5, 0, 0),
      '=': () => zoom(getView(), 1.5, 0, 0),
      '-': () => getView().zoomAt(1 / 1.5, 0, 0, width()),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    setView(action());
  });
}
