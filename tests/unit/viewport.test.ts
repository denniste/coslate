import { describe, expect, it } from 'vitest';
import {
  boundsOfPoints,
  clampScale,
  fitToContent,
  MAX_SCALE,
  MIN_SCALE,
  objectBounds,
  panBy,
  screenToWorld,
  unionBounds,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
  zoomTo,
  type Viewport,
} from '@coslate/core';

const close = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance;

describe('viewport: world <-> screen', () => {
  const viewport: Viewport = { x: 40, y: -25, scale: 1.75 };

  it('round-trips points exactly', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 123.5, y: -678.25 },
      { x: -9999, y: 4242 },
    ];
    for (const point of points) {
      const back = screenToWorld(viewport, worldToScreen(viewport, point));
      expect(close(back.x, point.x)).toBe(true);
      expect(close(back.y, point.y)).toBe(true);
    }
  });

  it('matches the documented formula', () => {
    expect(worldToScreen({ x: 10, y: 20, scale: 2 }, { x: 30, y: 40 })).toEqual({ x: 40, y: 40 });
    expect(screenToWorld({ x: 10, y: 20, scale: 2 }, { x: 40, y: 40 })).toEqual({ x: 30, y: 40 });
  });

  it('maps the viewport origin to the screen origin', () => {
    expect(worldToScreen(viewport, { x: viewport.x, y: viewport.y })).toEqual({ x: 0, y: 0 });
  });
});

describe('viewport: zoom', () => {
  it('keeps the world point under the cursor pinned (zoom-at-point invariance)', () => {
    const viewport: Viewport = { x: 10, y: -20, scale: 1.5 };
    const cursor = { x: 300, y: 200 };
    const worldBefore = screenToWorld(viewport, cursor);

    for (const factor of [1.1, 0.9, 2, 0.5, 1.0001]) {
      const zoomed = zoomAt(viewport, cursor, factor);
      const worldAfter = screenToWorld(zoomed, cursor);
      expect(close(worldAfter.x, worldBefore.x, 1e-9)).toBe(true);
      expect(close(worldAfter.y, worldBefore.y, 1e-9)).toBe(true);
      expect(close(zoomed.scale, viewport.scale * factor, 1e-9)).toBe(true);
    }
  });

  it('clamps scale and still pins the cursor when clamped', () => {
    const viewport: Viewport = { x: 0, y: 0, scale: 1 };
    const cursor = { x: 100, y: 100 };
    const tooBig = zoomAt(viewport, cursor, 1000);
    expect(tooBig.scale).toBe(MAX_SCALE);

    const tooSmall = zoomAt(viewport, cursor, 0.00001);
    expect(tooSmall.scale).toBe(MIN_SCALE);

    const worldBefore = screenToWorld(viewport, cursor);
    const worldAfter = screenToWorld(tooBig, cursor);
    expect(close(worldAfter.x, worldBefore.x)).toBe(true);
    expect(close(worldAfter.y, worldBefore.y)).toBe(true);
  });

  it('zoomTo sets an absolute scale', () => {
    const zoomed = zoomTo({ x: 0, y: 0, scale: 1 }, { x: 50, y: 50 }, 3);
    expect(zoomed.scale).toBe(3);
    expect(close(zoomed.x, 50 - 50 / 3)).toBe(true);
  });

  it('clampScale handles bad input', () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
    expect(clampScale(-4)).toBe(MIN_SCALE);
    expect(clampScale(12345)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });
});

describe('viewport: wheel zoom factor', () => {
  // A hardware notch is ~100 px of deltaY; plain wheel should land near ×1.20
  // there (was ×1.82 with the pre-0.2.2 constants), ctrl/meta near ×1.06.
  it('targets ~x1.20 per 100 px plain notch', () => {
    const factor = wheelZoomFactor(-100, 0, false);
    expect(close(factor, 1.197, 0.01)).toBe(true);
    // ...and the same travel out zooms symmetrically.
    expect(close(wheelZoomFactor(100, 0, false), 1 / 1.197, 0.01)).toBe(true);
  });

  it('makes ctrl/meta (the fine step, and a trackpad pinch) finer than plain wheel', () => {
    const plain = wheelZoomFactor(-100, 0, false);
    const fine = wheelZoomFactor(-100, 0, true);
    expect(close(fine, 1.062, 0.005)).toBe(true);
    expect(fine).toBeLessThan(plain);
  });

  it('normalizes line-mode deltas (Firefox wheels) into pixels', () => {
    // 3 lines at 16 px/line = 48 px of pixel-mode travel.
    expect(close(wheelZoomFactor(-3, 1, false), wheelZoomFactor(-48, 0, false), 1e-12)).toBe(true);
  });

  it('normalizes page-mode deltas into pixels', () => {
    expect(close(wheelZoomFactor(-1, 2, false), wheelZoomFactor(-100, 0, false), 1e-12)).toBe(true);
  });

  it('keeps trackpad-sized gestures proportional (exponential, not linear)', () => {
    // Twenty small deltas of 5 px equal one 100 px notch, so a pinch never
    // lurches regardless of how the hardware splits the travel.
    let accumulated = 1;
    for (let i = 0; i < 20; i++) accumulated *= wheelZoomFactor(-5, 0, true);
    expect(close(accumulated, wheelZoomFactor(-100, 0, true), 1e-12)).toBe(true);
  });
});

describe('viewport: pan', () => {
  it('translates screen drag into world offset at the current scale', () => {
    const panned = panBy({ x: 0, y: 0, scale: 2 }, 100, -50);
    expect(panned).toEqual({ x: -50, y: 25, scale: 2 });
  });

  it('panning by a screen delta moves content by that many pixels', () => {
    const viewport: Viewport = { x: 5, y: 5, scale: 1.25 };
    const world = { x: 12, y: 8 };
    const before = worldToScreen(viewport, world);
    const after = worldToScreen(panBy(viewport, 30, -12), world);
    expect(close(after.x - before.x, 30)).toBe(true);
    expect(close(after.y - before.y, -12)).toBe(true);
  });
});

describe('viewport: bounds and fit', () => {
  it('computes bounds of a point list', () => {
    expect(boundsOfPoints([10, 10, 30, 5, 20, 40])).toEqual({ x: 10, y: 5, width: 20, height: 35 });
    expect(boundsOfPoints([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('unions bounds', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 20, y: -5, width: 10, height: 10 };
    expect(unionBounds(a, b)).toEqual({ x: 0, y: -5, width: 30, height: 15 });
    expect(unionBounds(null, b)).toBe(b);
  });

  it('fits content inside the viewport with padding', () => {
    const bounds = { x: -50, y: -50, width: 100, height: 100 };
    const size = { width: 500, height: 300 };
    const viewport = fitToContent(bounds, size, 50);
    expect(close(viewport.scale, 2)).toBe(true);

    const topLeft = worldToScreen(viewport, { x: bounds.x, y: bounds.y });
    const bottomRight = worldToScreen(viewport, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
    expect(topLeft.x).toBeGreaterThanOrEqual(49.999);
    expect(bottomRight.x).toBeLessThanOrEqual(size.width - 49.999);
    expect(topLeft.y).toBeGreaterThanOrEqual(49.999);
    expect(bottomRight.y).toBeLessThanOrEqual(size.height - 49.999);
  });

  it('handles empty content without dividing by zero', () => {
    const viewport = fitToContent(null, { width: 400, height: 400 }, 40);
    expect(viewport.scale).toBe(1);
    expect(Number.isFinite(viewport.x)).toBe(true);
    expect(Number.isFinite(viewport.y)).toBe(true);
  });

  it('computes rotated object bounds', () => {
    const bounds = objectBounds({ x: 0, y: 0, width: 100, height: 0, rotation: 90, scaleX: 1, scaleY: 1 });
    expect(close(bounds.width, 0, 1e-9)).toBe(true);
    expect(close(bounds.height, 100, 1e-9)).toBe(true);

    const scaled = objectBounds({ x: 10, y: 10, width: 50, height: 20, rotation: 0, scaleX: 2, scaleY: 3 });
    expect(scaled).toEqual({ x: 10, y: 10, width: 100, height: 60 });
  });
});
