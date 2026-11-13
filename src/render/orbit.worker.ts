import { computeOrbit, type OrbitRequest } from './orbit';

// Runs the BigInt reference orbit off the main thread, so deep zooms with many
// iterations don't freeze the page.
self.onmessage = (event: MessageEvent<OrbitRequest>) => {
  const result = computeOrbit(event.data);
  (self as unknown as Worker).postMessage(result, [result.points.buffer]);
};
