import './app.css';
import { createSceneViewer } from '@coslate/konva';
import type { BaselineReadResult, GridAppearance, Scene, SceneDelta, Viewport } from '@coslate/core';

/**
 * Read-only viewer entry.
 *
 * This page proves the projection path end to end: it mounts
 * `createSceneViewer` — no editor, no tools, no toolbar, no input handlers — and
 * exposes a small hook so a host (or a test) can feed it inbound deltas and move
 * the camera. There is deliberately no way to write the document from here.
 */

const host = document.getElementById('viewer');
if (!host) {
  throw new Error('CoSlate viewer: expected #viewer in the document');
}

const viewer = createSceneViewer({
  container: host,
  background: '#14161a',
});

declare global {
  interface Window {
    __viewer?: {
      applyDelta(delta: SceneDelta): boolean;
      getScene(): Scene;
      setViewport(viewport: Viewport): void;
      getViewport(): Viewport;
      getViewConfig(): { background: string; grid: GridAppearance };
      setBackground(color: string): void;
      setGrid(partial: Partial<GridAppearance>): void;
      applyBaseline(scene: Scene): boolean;
      loadBaseline(json: string): BaselineReadResult;
      destroy(): void;
    };
  }
}

window.__viewer = {
  applyDelta: (delta) => viewer.applyDelta(delta),
  getScene: () => viewer.getScene(),
  setViewport: (viewport) => viewer.setViewport(viewport),
  getViewport: () => viewer.getViewport(),
  getViewConfig: () => ({
    background: viewer.renderer.getBackground(),
    grid: { ...viewer.renderer.getGrid() },
  }),
  setBackground: (color) => viewer.setBackground(color),
  setGrid: (partial) => viewer.setGrid(partial),
  applyBaseline: (scene) => viewer.applyBaseline(scene),
  loadBaseline: (json) => viewer.loadBaseline(json),
  destroy: () => viewer.destroy(),
};
