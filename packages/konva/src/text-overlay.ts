import type { Point } from '@coslate/core';

/**
 * The text editing surface.
 *
 * Text is the one thing a canvas cannot do well: caret placement, selection,
 * IME composition and accessibility all live in the DOM. So CoSlate renders
 * text *on* the canvas but edits it in a real `<textarea>` positioned over the
 * shape and transformed to match its world position exactly.
 *
 * The overlay never edits the scene: it reports a string back to the editor,
 * which commits one command.
 */

export interface TextOverlayOptions {
  screen: Point;
  rotation: number;
  scale: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  value: string;
  placeholder?: string;
  /**
   * Accessible name for the field. Supplied by the caller because the runtime
   * ships no copy — a hardcoded English `aria-label` is a localization bug that
   * only screen-reader users ever see, which is the worst kind.
   */
  ariaLabel?: string;
  onCommit(value: string): void;
  onCancel?(): void;
}

const MIN_WIDTH_PX = 8;

export class TextOverlay {
  private readonly host: HTMLElement;
  private textarea: HTMLTextAreaElement | null = null;
  private options: TextOverlayOptions | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  isOpen(): boolean {
    return this.textarea !== null;
  }

  open(options: TextOverlayOptions): void {
    this.close();
    this.options = options;

    const textarea = document.createElement('textarea');
    textarea.className = 'coslate-text-overlay';
    textarea.value = options.value;
    textarea.rows = 1;
    textarea.wrap = 'off';
    textarea.spellcheck = false;
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocomplete', 'off');
    const ariaLabel = options.ariaLabel?.trim();
    if (ariaLabel) textarea.setAttribute('aria-label', ariaLabel);
    if (options.placeholder !== undefined) textarea.placeholder = options.placeholder;

    Object.assign(textarea.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      margin: '0',
      padding: '0',
      border: '1px dashed rgba(77, 171, 247, 0.9)',
      outline: 'none',
      background: 'rgba(20, 22, 26, 0.35)',
      resize: 'none',
      overflow: 'hidden',
      whiteSpace: 'pre',
      boxSizing: 'content-box',
      caretColor: options.color,
      color: options.color,
      fontFamily: options.fontFamily,
      fontSize: `${options.fontSize}px`,
      lineHeight: '1',
      transformOrigin: '0 0',
      zIndex: '5',
    } satisfies Partial<CSSStyleDeclaration>);

    textarea.addEventListener('keydown', this.handleKeyDown);
    textarea.addEventListener('input', this.handleInput);
    textarea.addEventListener('blur', this.handleBlur);
    textarea.addEventListener('pointerdown', this.stopPropagation);
    textarea.addEventListener('wheel', this.stopPropagation);

    this.textarea = textarea;
    this.host.appendChild(textarea);
    this.reposition(options.screen, options.scale, options.rotation);
    this.autosize();

    // Focus after layout so the caret lands in the right place.
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  /** Keep the editor glued to its shape while the camera moves. */
  reposition(screen: Point, scale: number, rotation: number): void {
    const textarea = this.textarea;
    if (!textarea || !this.options) return;
    this.options.screen = screen;
    this.options.scale = scale;
    this.options.rotation = rotation;
    const parts = [`translate(${screen.x}px, ${screen.y}px)`];
    if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
    if (scale !== 1) parts.push(`scale(${scale})`);
    textarea.style.transform = parts.join(' ');
  }

  /** Commit whatever is in the box and close. */
  commit(): void {
    const textarea = this.textarea;
    const options = this.options;
    if (!textarea || !options) return;
    const value = textarea.value;
    this.teardown();
    options.onCommit(value);
  }

  /** Close without committing. */
  cancel(): void {
    const options = this.options;
    if (!this.textarea || !options) return;
    this.teardown();
    options.onCancel?.();
  }

  close(): void {
    this.teardown();
  }

  private teardown(): void {
    const textarea = this.textarea;
    this.textarea = null;
    this.options = null;
    if (!textarea) return;
    textarea.removeEventListener('keydown', this.handleKeyDown);
    textarea.removeEventListener('input', this.handleInput);
    textarea.removeEventListener('blur', this.handleBlur);
    textarea.removeEventListener('pointerdown', this.stopPropagation);
    textarea.removeEventListener('wheel', this.stopPropagation);
    textarea.remove();
  }

  private readonly stopPropagation = (event: Event): void => {
    event.stopPropagation();
  };

  private readonly handleInput = (): void => {
    this.autosize();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return;
    }
    // Enter commits, Shift+Enter inserts a line break, Ctrl/Cmd+Enter commits.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.commit();
      return;
    }
    event.stopPropagation();
  };

  private readonly handleBlur = (): void => {
    this.commit();
  };

  private autosize(): void {
    const textarea = this.textarea;
    if (!textarea) return;
    const fontSize = this.options?.fontSize ?? 16;
    textarea.style.height = 'auto';
    textarea.style.width = 'auto';
    const height = Math.max(fontSize, textarea.scrollHeight);
    const width = Math.max(MIN_WIDTH_PX, textarea.scrollWidth + 2);
    textarea.style.height = `${height}px`;
    textarea.style.width = `${width}px`;
  }
}
