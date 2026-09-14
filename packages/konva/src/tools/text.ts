import type { Tool, ToolHost, PointerInfo } from './types.js';

/**
 * Text tool.
 *
 * A click does not create an object: it opens the DOM editing overlay. The
 * object is created (or updated) only when the text is committed, which means
 * an abandoned click leaves no empty text box behind — and one edit is one undo
 * step, whether it was a new label or a correction.
 */

export class TextTool implements Tool {
  public readonly name = 'text' as const;
  public readonly cursor = 'text';

  private readonly host: ToolHost;

  constructor(host: ToolHost) {
    this.host = host;
  }

  onPointerDown(info: PointerInfo): void {
    if (info.button !== 0) return;
    const viewport = this.host.getViewport();
    this.host.openTextEditor({
      screen: info.screen,
      world: info.world,
      rotation: 0,
      scale: viewport.scale,
      fontSize: this.host.style.fontSize,
      fontFamily: this.host.style.fontFamily,
      color: this.host.style.stroke,
      value: '',
      objectId: null,
    });
  }
}
