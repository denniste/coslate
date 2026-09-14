import { revertCommands, type Command } from './command.js';
import { applyCommands } from './command.js';

/**
 * One undo step. A transaction produces exactly one entry, no matter how many
 * commands were dispatched inside it — that is the entire point of grouping.
 */
export interface HistoryEntry {
  txId: string;
  label: string;
  commands: Command[];
  timestamp: number;
}

export interface HistoryOptions {
  /** Maximum number of undo steps retained. Oldest entries are dropped first. */
  limit?: number;
}

export const DEFAULT_HISTORY_LIMIT = 200;

/**
 * Bounded undo/redo stack built purely from command inverses.
 *
 * There are no snapshots here: memory is proportional to the number of edits,
 * not to document size. The bound is a hard cap so a long session cannot grow
 * without limit.
 */
export class History {
  private readonly limit: number;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(options: HistoryOptions = {}) {
    const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`CoSlate: history limit must be a positive integer, got ${String(limit)}`);
    }
    this.limit = limit;
  }

  /** Record a completed atomic step and invalidate the redo branch. */
  push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Undo one step. Returns the commands to revert, or `null` if nothing to undo. */
  takeUndo(): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  /** Redo one step. Returns the entry to re-apply, or `null` if nothing to redo. */
  takeRedo(): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  /** Drop the redo branch. Used when an out-of-band change lands (e.g. remote). */
  clearRedo(): void {
    this.redoStack = [];
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Snapshot for UI/debugging; does not expose the internal arrays. */
  inspect(): { undo: HistoryEntry[]; redo: HistoryEntry[]; limit: number } {
    return { undo: this.undoStack.slice(), redo: this.redoStack.slice(), limit: this.limit };
  }

  get depth(): number {
    return this.undoStack.length;
  }
}

/** Re-apply an entry forwards (redo). */
export function redoEntry<T>(document: T, entry: HistoryEntry): T {
  return applyCommands(document, entry.commands);
}

/** Roll an entry backwards (undo). */
export function undoEntry<T>(document: T, entry: HistoryEntry): T {
  return revertCommands(document, entry.commands);
}
