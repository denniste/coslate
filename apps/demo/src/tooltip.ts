/**
 * One shared tooltip layer for the chrome.
 *
 * Icons alone are fast to scan but ambiguous the first time, so every control
 * carries a text hint. A single fixed-position node is reused for all of them
 * instead of the native `title` bubble: `title` cannot show a shortcut badge,
 * cannot be styled, and takes about a second to appear — long enough that
 * nobody waits for it.
 */

export interface TooltipContent {
  label: string;
  /** Keyboard shortcut, shown as a badge. */
  hint?: string;
}

/**
 * Static content, or a function read at hover time. The function form is what
 * makes hints survive a locale change without every control being rebuilt.
 */
export type TooltipSource = TooltipContent | (() => TooltipContent);

export interface TooltipLayer {
  /** Attach a hint to a control; also sets its `aria-label`. */
  bind(target: HTMLElement, content: TooltipSource): void;
  /** Re-read every bound label. Call after a locale change. */
  refresh(): void;
  hide(): void;
}

const GAP = 8;
const MARGIN = 8;

function describe(content: TooltipContent): string {
  return content.hint ? `${content.label} (${content.hint})` : content.label;
}

export function createTooltipLayer(host: HTMLElement = document.body): TooltipLayer {
  const node = document.createElement('div');
  node.className = 'tooltip';
  node.setAttribute('role', 'tooltip');
  node.hidden = true;
  host.append(node);

  const bindings: { target: HTMLElement; content: TooltipSource }[] = [];
  const resolve = (content: TooltipSource): TooltipContent =>
    typeof content === 'function' ? content() : content;

  function place(target: HTMLElement): void {
    const anchor = target.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    // Controls in the toolbar hang their hint off the bar's bottom edge, so a
    // hint never lands on top of the toolbar's second row.
    const bar = target.closest('.toolbar');
    const bottom = bar ? bar.getBoundingClientRect().bottom : anchor.bottom;
    // Below the control by default; flip above when it would fall off-screen.
    const below = bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN ? anchor.top - height - GAP : below;
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
  }

  function show(target: HTMLElement, content: TooltipContent): void {
    const label = document.createElement('span');
    label.className = 'tooltip-label';
    label.textContent = content.label;
    node.replaceChildren(label);
    if (content.hint) {
      const hint = document.createElement('kbd');
      hint.className = 'tooltip-hint';
      hint.textContent = content.hint;
      node.append(hint);
    }
    node.hidden = false;
    place(target);
  }

  function hide(): void {
    node.hidden = true;
  }

  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);

  return {
    hide,
    bind(target, content) {
      bindings.push({ target, content });
      target.setAttribute('aria-label', describe(resolve(content)));
      target.addEventListener('pointerenter', () => show(target, resolve(content)));
      target.addEventListener('pointerleave', hide);
      target.addEventListener('focus', () => show(target, resolve(content)));
      target.addEventListener('blur', hide);
      // The tooltip must never sit between the pointer and the thing it describes.
      target.addEventListener('pointerdown', hide);
    },
    refresh() {
      for (const binding of bindings) binding.target.setAttribute('aria-label', describe(resolve(binding.content)));
    },
  };
}
