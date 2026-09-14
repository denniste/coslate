import { newId } from './ids.js';
import { applyPatch, invertPatch, type JSONPatchOp } from './jsonpatch.js';
import type { Id } from './types.js';

/**
 * Where a command came from.
 *
 * This is not decoration. `source` is what lets a future sync layer answer "do I
 * echo this to peers?", lets the UI distinguish a user edit from a programmatic
 * one, and lets an AI client be treated as exactly what it is: just another
 * producer of commands.
 */
export type CommandSource = 'user' | 'api' | 'system';

/**
 * The only way the scene ever changes.
 *
 * A command is a *value*: JSON-serializable, replayable, invertible. It carries
 * both the forward patch and the inverse patch, so undo needs no snapshots and
 * a remote peer needs no shared mutable state.
 */
export interface Command {
  id: Id;
  /** Verb-ish label, e.g. `object.create`, `object.move`, `object.delete`. */
  type: string;
  patch: JSONPatchOp[];
  /** Operations that exactly undo `patch` when applied back-to-front. */
  inverse: JSONPatchOp[];
  source: CommandSource;
  /** Set when the command belongs to a transaction; all commands in one transaction share it. */
  txId?: string;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Optional human-readable description, used by history UIs and debugging. */
  label?: string;
  /**
   * View-only change: applied to the document and broadcast to subscribers, but
   * never recorded as an undo step. The camera (pan/zoom) uses this so that
   * `Ctrl+Z` undoes *content*, which is what a user means by "undo".
   */
  transient?: boolean;
}

export interface CreateCommandInput {
  type: string;
  patch: JSONPatchOp[];
  source?: CommandSource;
  txId?: string;
  label?: string;
  transient?: boolean;
  id?: Id;
  timestamp?: number;
}

/**
 * Build a command and compute its inverse against the document it will be
 * applied to. Always prefer this over hand-writing a `Command` literal: a wrong
 * inverse is a corrupted document waiting to happen.
 */
export function createCommand(document: unknown, input: CreateCommandInput): Command {
  const command: Command = {
    id: input.id ?? newId('cmd'),
    type: input.type,
    patch: input.patch,
    inverse: invertPatch(document, input.patch),
    source: input.source ?? 'user',
    timestamp: input.timestamp ?? Date.now(),
  };
  if (input.txId !== undefined) command.txId = input.txId;
  if (input.label !== undefined) command.label = input.label;
  if (input.transient !== undefined) command.transient = input.transient;
  return command;
}

/** Apply a list of commands forward, immutably. */
export function applyCommands<T>(document: T, commands: readonly Command[]): T {
  let next: T = document;
  for (const command of commands) next = applyPatch(next, command.patch);
  return next;
}

/**
 * Apply a list of commands backwards (for undo). Inverses within one command are
 * already stored back-to-front; the command list itself must also be walked in
 * reverse.
 */
export function revertCommands<T>(document: T, commands: readonly Command[]): T {
  let next: T = document;
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const command = commands[i];
    if (command) next = applyPatch(next, command.inverse);
  }
  return next;
}

function isPatchOp(value: unknown): value is JSONPatchOp {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { op?: unknown; path?: unknown };
  return (
    (candidate.op === 'add' || candidate.op === 'replace' || candidate.op === 'remove') &&
    typeof candidate.path === 'string'
  );
}

/**
 * Structural validation for commands arriving from outside the process (a file,
 * a websocket, a test harness). Untrusted input is narrowed, never assumed.
 */
export function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.type === 'string' &&
    Array.isArray(candidate.patch) &&
    candidate.patch.every(isPatchOp) &&
    Array.isArray(candidate.inverse) &&
    candidate.inverse.every(isPatchOp) &&
    (candidate.source === 'user' || candidate.source === 'api' || candidate.source === 'system') &&
    (candidate.transient === undefined || typeof candidate.transient === 'boolean') &&
    typeof candidate.timestamp === 'number'
  );
}
