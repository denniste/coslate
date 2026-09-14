import {
  createStore,
  type Id,
  type Scene,
  type SceneDelta,
  type SceneStore,
  type Viewport,
} from '@coslate/core';
import { DEFAULT_VIEWPORT } from '@coslate/core';
import { SceneRenderer } from './renderer.js';

/**
 * The read-only projection.
 *
 * A viewer is an audience member: it renders the board and follows what the
 * room sends, and it has no way to change the document. That is not a mode of
 * the editor — there is no editor here, no tools, no transformer, no text
 * overlay, no input handlers at all. An anonymous participant cannot accidentally
 * gain write access to something that was never wired to write.
 *
 * It is deliberately the *same* inbound path the editor uses
 * (`SceneStore.applyDelta`), so a viewer and an editor converge on identical
 * state from identical messages: idempotent, atomic, and never in a history.
 */

export interface SceneViewerOptions {
  container: HTMLElement;
  /** Starting document. Deltas may arrive before the baseline does. */
  scene?: Scene;
  viewport?: Viewport;
  background?: string;
  /** Watch the container and resize the stage. Defaults to `true`. */
  observeResize?: boolean;
}

export interface SceneViewer {
  /** Escape hatch for host-drawn overlays (presence, cursors, watermarks). */
  readonly renderer: SceneRenderer;
  /** Escape hatch for hosts that keep their own state in the same store. */
  readonly store: SceneStore;
  getScene(): Scene;
  /** Replace the document wholesale — a baseline, or a `req-snap` reply. */
  setScene(scene: Scene): void;
  /** Apply one inbound message. Returns whether anything changed. */
  applyDelta(delta: SceneDelta): boolean;
  /** Follow a remote camera, e.g. a "broadcast my view" feature. */
  setViewport(viewport: Viewport): void;
  getViewport(): Viewport;
  /** Canvas size in CSS pixels; call after a layout change. */
  resize(): void;
  destroy(): void;
}

export function createSceneViewer(options: SceneViewerOptions): SceneViewer {
  const { container } = options;
  if (typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const host = document.createElement('div');
  host.className = 'coslate-canvas-host';
  Object.assign(host.style, {
    position: 'absolute',
    inset: '0',
    // No pointer handlers are installed; this only stops the browser from
    // hijacking touch gestures the host may want for its own chrome.
    touchAction: 'none',
    overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);
  container.appendChild(host);

  const store = createStore(options.scene ? { scene: options.scene } : {});
  const renderer = new SceneRenderer({
    container: host,
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
    background: options.background ?? '#14161a',
  });
  renderer.attach(store);
  let viewport: Viewport = { ...DEFAULT_VIEWPORT, ...(options.viewport ?? {}) };
  renderer.applyViewport(viewport);

  let observer: ResizeObserver | null = null;
  if (options.observeResize !== false && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => resize());
    observer.observe(container);
  }

  function resize(): void {
    renderer.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  }

  return {
    renderer,
    store,
    getScene: () => store.getState(),
    setScene: (scene: Scene) => {
      store.reset(scene);
    },
    applyDelta: (delta: SceneDelta) => store.applyDelta(delta),
    setViewport: (next: Viewport) => {
      viewport = { ...next };
      renderer.applyViewport(viewport);
    },
    getViewport: () => ({ ...viewport }),
    resize,
    destroy: () => {
      observer?.disconnect();
      observer = null;
      renderer.destroy();
      host.remove();
    },
  };
}

/** Convenience for hosts that only need to show a snapshot and never update it. */
export function renderSceneOnce(container: HTMLElement, scene: Scene): SceneViewer {
  return createSceneViewer({ container, scene });
}

/** Re-exported so a viewer-only host needs one import. */
export type { Id, Scene, SceneDelta, Viewport };
