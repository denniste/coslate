import { removeObjectOps, type Id } from '@coslate/core';
import type { PointerInfo, Tool, ToolHost } from './types.js';

/**
 * Eraser tool: hit-test delete.
 *
 * Touching an object hides its *node* immediately (so the gesture feels
 * instant), but the deletion is only committed on pointer-up, as one
 * transaction. Erasing five shapes is one Ctrl+Z, not five.
 */

export class EraserTool implements Tool {
  public readonly name = 'eraser' as const;
  public readonly cursor = 'cell';

  private readonly host: ToolHost;
  private erasing = false;
  private readonly erased: Id[] = [];

  constructor(host: ToolHost) {
    this.host = host;
  }

  deactivate(): void {
    this.restoreNodes();
  }

  onPointerDown(info: PointerInfo): void {
    if (info.button !== 0) return;
    this.erasing = true;
    this.erased.length = 0;
    this.eraseAt(info);
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.erasing) return;
    this.eraseAt(info);
  }

  onPointerUp(): void {
    if (!this.erasing) return;
    this.erasing = false;
    const ids = this.erased.slice();
    this.erased.length = 0;
    if (ids.length === 0) return;

    const store = this.host.store;
    store.transaction(
      (_scene, tx) => {
        for (const id of ids) {
          store.dispatch(
            tx.commit('object.delete', removeObjectOps(store.getState(), id), { label: 'Erase' }),
          );
        }
      },
      { label: ids.length > 1 ? `Erase ${ids.length} objects` : 'Erase' },
    );
    this.host.setSelection(this.host.getSelection().filter((id) => !ids.includes(id)));
    this.host.requestDraw();
  }

  private eraseAt(info: PointerInfo): void {
    const hit = this.host.hitTest(info.world);
    if (!hit || this.erased.includes(hit.id)) return;
    this.erased.push(hit.id);
    const node = this.host.getNode(hit.id);
    if (node) node.visible(false);
    this.host.requestDraw();
  }

  private restoreNodes(): void {
    for (const id of this.erased) {
      const node = this.host.getNode(id);
      if (node) node.visible(true);
    }
    this.erased.length = 0;
    this.erasing = false;
    this.host.requestDraw();
  }
}
