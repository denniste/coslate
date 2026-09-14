import Konva from 'konva';
import { isObjectOfType, updateObjectOps, type Id, type Point } from '@coslate/core';
import { objectsInBounds } from '../geometry.js';
import type { PointerInfo, Tool, ToolHost } from './types.js';

/**
 * Select tool: click, shift-click, marquee, drag and transform.
 *
 * Gesture discipline is the whole point of this file:
 *  - during a drag the *nodes* move (instant feedback, no store traffic);
 *  - on pointer-up exactly one transaction is committed, so one Ctrl+Z undoes
 *    the entire gesture no matter how many objects moved.
 */

const DRAG_THRESHOLD_PX = 3;

type Mode = 'idle' | 'press' | 'drag' | 'marquee';

export class SelectTool implements Tool {
  public readonly name = 'select' as const;
  public readonly cursor = 'default';

  private readonly host: ToolHost;
  private mode: Mode = 'idle';
  private startScreen: Point = { x: 0, y: 0 };
  private startWorld: Point = { x: 0, y: 0 };
  private readonly origins = new Map<Id, Point>();
  private baseSelection: Id[] = [];
  private marquee: Konva.Rect | null = null;
  private didMove = false;

  constructor(host: ToolHost) {
    this.host = host;
  }

  deactivate(): void {
    this.cancelGesture();
  }

  onPointerDown(info: PointerInfo): void {
    if (info.button !== 0) return;
    const hit = this.host.hitTest(info.world);
    this.startScreen = info.screen;
    this.startWorld = info.world;
    this.didMove = false;

    if (hit) {
      if (info.shiftKey) {
        this.host.toggleSelection(hit.id);
      } else if (!this.host.isSelected(hit.id)) {
        this.host.setSelection([hit.id]);
      }
      this.mode = 'press';
      this.origins.clear();
      for (const id of this.host.getSelection()) {
        const object = this.host.store.getObject(id);
        if (object) this.origins.set(id, { x: object.x, y: object.y });
      }
      return;
    }

    if (!info.shiftKey) this.host.setSelection([]);
    this.baseSelection = this.host.getSelection();
    this.mode = 'marquee';
    this.marquee = new Konva.Rect({
      x: info.screen.x,
      y: info.screen.y,
      width: 0,
      height: 0,
      fill: 'rgba(77, 171, 247, 0.12)',
      stroke: '#4dabf7',
      strokeWidth: 1,
      dash: [4, 4],
      listening: false,
      perfectDrawEnabled: false,
    });
    this.host.overlay.add(this.marquee);
    this.host.requestDraw();
  }

  onPointerMove(info: PointerInfo): void {
    if (this.mode === 'idle') return;

    if (!this.didMove) {
      const travelled = Math.hypot(info.screen.x - this.startScreen.x, info.screen.y - this.startScreen.y);
      if (travelled < DRAG_THRESHOLD_PX) return;
      this.didMove = true;
      if (this.mode === 'press') this.mode = 'drag';
    }

    if (this.mode === 'drag') {
      const dx = info.world.x - this.startWorld.x;
      const dy = info.world.y - this.startWorld.y;
      for (const [id, origin] of this.origins) {
        const node = this.host.getNode(id);
        if (!node) continue;
        node.x(origin.x + dx);
        node.y(origin.y + dy);
      }
      this.host.refreshTransformer();
      this.host.requestDraw();
      return;
    }

    if (this.mode === 'marquee' && this.marquee) {
      this.marquee.setAttrs({
        x: Math.min(this.startScreen.x, info.screen.x),
        y: Math.min(this.startScreen.y, info.screen.y),
        width: Math.abs(info.screen.x - this.startScreen.x),
        height: Math.abs(info.screen.y - this.startScreen.y),
      });
      this.host.requestDraw();
    }
  }

  onPointerUp(info: PointerInfo): void {
    if (this.mode === 'idle') return;

    if (this.mode === 'drag') {
      this.commitDrag();
    } else if (this.mode === 'marquee') {
      this.commitMarquee(info);
    }

    this.cancelGesture();
    this.host.refreshTransformer();
    this.host.requestDraw();
  }

  onDoubleClick(info: PointerInfo): void {
    const hit = this.host.hitTest(info.world);
    if (!hit || !isObjectOfType(hit, 'shape.text')) return;
    this.host.setSelection([hit.id]);
    const viewport = this.host.getViewport();
    this.host.openTextEditor({
      screen: {
        x: (hit.x - viewport.x) * viewport.scale,
        y: (hit.y - viewport.y) * viewport.scale,
      },
      world: { x: hit.x, y: hit.y },
      rotation: hit.rotation,
      scale: viewport.scale,
      fontSize: hit.data.fontSize,
      fontFamily: hit.data.fontFamily,
      color: hit.data.fill ?? '#ffffff',
      value: hit.data.text,
      objectId: hit.id,
    });
  }

  private commitDrag(): void {
    if (!this.didMove) return;
    const moves: { id: Id; x: number; y: number }[] = [];
    for (const [id, origin] of this.origins) {
      const node = this.host.getNode(id);
      if (!node) continue;
      const x = node.x();
      const y = node.y();
      if (Math.abs(x - origin.x) < 0.001 && Math.abs(y - origin.y) < 0.001) continue;
      moves.push({ id, x, y });
    }
    if (moves.length === 0) return;

    const store = this.host.store;
    store.transaction(
      (_scene, tx) => {
        for (const move of moves) {
          store.dispatch(tx.commit('object.move', updateObjectOps(move.id, { x: move.x, y: move.y }), { label: 'Move' }));
        }
      },
      { label: moves.length > 1 ? `Move ${moves.length} objects` : 'Move' },
    );
  }

  private commitMarquee(info: PointerInfo): void {
    if (!this.didMove) return;
    const bounds = {
      x: Math.min(this.startWorld.x, info.world.x),
      y: Math.min(this.startWorld.y, info.world.y),
      width: Math.abs(info.world.x - this.startWorld.x),
      height: Math.abs(info.world.y - this.startWorld.y),
    };
    const found = objectsInBounds(this.host.getScene(), bounds).map((object) => object.id);
    const merged = new Set(this.baseSelection);
    for (const id of found) merged.add(id);
    this.host.setSelection(Array.from(merged));
  }

  private cancelGesture(): void {
    this.mode = 'idle';
    this.didMove = false;
    this.origins.clear();
    this.baseSelection = [];
    if (this.marquee) {
      this.marquee.destroy();
      this.marquee = null;
      this.host.requestDraw();
    }
  }
}
