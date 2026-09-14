import { applyPatch, invertPatch, type JSONPatchOp } from './jsonpatch.js';
import { createCommand, isCommand, type Command, type CommandSource } from './command.js';
import { History, redoEntry, undoEntry, DEFAULT_HISTORY_LIMIT, type HistoryEntry } from './history.js';
import { newId } from './ids.js';
import type { Id, Scene, SceneObject } from './types.js';
import { SCENE_FORMAT, SCENE_VERSION } from './types.js';

/**
 * The store: a tiny, pure state container around a {@link Scene}.
 *
 * Properties that matter and are therefore guaranteed:
 *  - the state is immutable; every change produces a new `Scene` object and
 *    structurally shares every untouched object;
 *  - the only way in is a {@link Command} (or a batch of them);
 *  - undo/redo is derived from command inverses, never from snapshots;
 *  - subscribers are notified once per atomic step, not once per command.
 *
 * There is no framework here, no proxy magic and no observability library. It is
 * a few hundred lines you can read in one sitting, which is the point.
 */

export type ChangeOrigin = 'local' | 'remote' | 'undo' | 'redo';

export interface ChangeEvent {
  scene: Scene;
  commands: readonly Command[];
  origin: ChangeOrigin;
  label: string;
}

export type StoreListener = (event: ChangeEvent) => void;

export interface TransactionOptions {
  /** Human-readable label shown in history UIs. */
  label?: string;
}

/** The handle passed to `transaction(fn)` callbacks. */
export interface TransactionContext {
  readonly txId: string;
  /** Commit a patch as one command inside the current transaction. */
  commit(
    type: string,
    patch: JSONPatchOp[],
    options?: { label?: string; source?: CommandSource; transient?: boolean },
  ): Command;
  /** The live scene, including changes made earlier in this same transaction. */
  readonly scene: Scene;
}

/** `store.scene` facade, so both `store.transaction(...)` and `scene.transaction(...)` read naturally. */
export interface SceneHandle {
  getState(): Scene;
  transaction<T>(fn: (scene: SceneHandle, tx: TransactionContext) => T, options?: TransactionOptions): T;
}

export interface StoreOptions {
  scene?: Scene;
  historyLimit?: number;
  /** Called for errors that must not tear down the session (e.g. a bad remote command). */
  onError?: (error: unknown, context: string) => void;
}

export interface CommitInput {
  type: string;
  patch: JSONPatchOp[];
  source?: CommandSource;
  label?: string;
  /** Apply without recording an undo step (camera moves, view-only state). */
  transient?: boolean;
}

export interface SceneStore {
  getState(): Scene;
  getObject(id: Id): SceneObject | undefined;
  /** Apply a command. Returns it as recorded (normalised txId and inverse). */
  dispatch(command: Command): Command;
  /** Build a command (computing its inverse) and dispatch it in one go. */
  commit(input: CommitInput): Command;
  /** Apply commands from an untrusted origin: forward only, never recorded in undo. */
  applyRemote(commands: readonly Command[]): void;
  subscribe(listener: StoreListener): () => void;
  transaction<T>(fn: (scene: SceneHandle, tx: TransactionContext) => T, options?: TransactionOptions): T;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  historyDepth(): { undo: number; redo: number; limit: number };
  /** Replace the whole document (load / clear). Clears history. */
  reset(scene: Scene): void;
  readonly scene: SceneHandle;
}

interface Frame {
  txId: string;
  label: string;
  startIndex: number;
}

/** A blank document. */
export function createEmptyScene(viewport: Scene['viewport'] = { x: 0, y: 0, scale: 1 }): Scene {
  return {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    viewport: { ...viewport },
    objects: {},
    order: [],
  };
}

export function createStore(options: StoreOptions = {}): SceneStore {
  let scene: Scene = options.scene ?? createEmptyScene();
  const history = new History({ limit: options.historyLimit ?? DEFAULT_HISTORY_LIMIT });
  const listeners = new Set<StoreListener>();
  const frames: Frame[] = [];

  /** Commands accumulated by the outermost open transaction. */
  let txCommands: Command[] = [];

  const reportError = (error: unknown, context: string): void => {
    if (options.onError) options.onError(error, context);
    else throw error;
  };

  const notify = (commands: readonly Command[], origin: ChangeOrigin, label: string): void => {
    const event: ChangeEvent = { scene, commands, origin, label };
    for (const listener of Array.from(listeners)) listener(event);
  };

  const currentTxId = (): string | undefined => (frames.length > 0 ? frames[0]?.txId : undefined);

  const applyOne = (command: Command): Command => {
    const txId = currentTxId();
    let normalized = command;
    if (txId !== undefined && command.txId !== txId) {
      normalized = { ...command, txId };
    } else if (txId === undefined && command.txId !== undefined) {
      // A command tagged with a transaction that is no longer open: drop the tag
      // so history does not report a group that does not exist.
      const { txId: _dropped, ...rest } = normalized;
      normalized = rest;
    }
    if (normalized.inverse.length === 0 && normalized.patch.length > 0) {
      // Forgiving by design: a hand-written command without an inverse still
      // undoes correctly instead of silently corrupting history.
      normalized = { ...normalized, inverse: invertPatch(scene, normalized.patch) };
    }
    scene = applyPatch(scene, normalized.patch);
    return normalized;
  };

  const store: SceneStore = {
    getState: () => scene,

    getObject: (id: Id) => scene.objects[id],

    dispatch(command: Command): Command {
      const normalized = applyOne(command);
      if (frames.length > 0) {
        txCommands.push(normalized);
        // Streaming, not batching: tools that dispatch inside a transaction
        // still get immediate visual feedback, while history stays grouped.
        notify([normalized], 'local', normalized.label ?? normalized.type);
        return normalized;
      }
      if (normalized.transient !== true) {
        history.push({
          txId: normalized.txId ?? newId('tx'),
          label: normalized.label ?? normalized.type,
          commands: [normalized],
          timestamp: normalized.timestamp,
        });
      }
      notify([normalized], 'local', normalized.label ?? normalized.type);
      return normalized;
    },

    commit(input: CommitInput): Command {
      return store.dispatch(createCommand(scene, input));
    },

    applyRemote(commands: readonly Command[]): void {
      const applied: Command[] = [];
      for (const candidate of commands) {
        if (!isCommand(candidate)) {
          reportError(new TypeError('CoSlate: applyRemote received a malformed command'), 'applyRemote');
          continue;
        }
        try {
          applied.push(applyOne(candidate));
        } catch (error) {
          reportError(error, `applyRemote:${candidate.type}`);
        }
      }
      if (applied.length === 0) return;
      // A remote change forks the timeline; keeping a stale redo branch would
      // let redo resurrect operations the remote peer already superseded.
      history.clearRedo();
      notify(applied, 'remote', 'remote');
    },

    subscribe(listener: StoreListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    transaction<T>(fn: (handle: SceneHandle, tx: TransactionContext) => T, options: TransactionOptions = {}): T {
      const isOutermost = frames.length === 0;
      const frame: Frame = {
        txId: isOutermost ? newId('tx') : (frames[0]?.txId ?? newId('tx')),
        label: options.label ?? (isOutermost ? 'Edit' : (frames[0]?.label ?? 'Edit')),
        startIndex: txCommands.length,
      };
      frames.push(frame);
      if (isOutermost) txCommands = [];

      const tx: TransactionContext = {
        txId: frame.txId,
        get scene() {
          return scene;
        },
        commit: (type, patch, commitOptions) =>
          createCommand(scene, {
            type,
            patch,
            txId: frame.txId,
            source: commitOptions?.source ?? 'user',
            ...(commitOptions?.label !== undefined ? { label: commitOptions.label } : {}),
            ...(commitOptions?.transient !== undefined ? { transient: commitOptions.transient } : {}),
          }),
      };

      try {
        const result = fn(store.scene, tx);
        frames.pop();

        if (isOutermost) {
          const commands = txCommands;
          txCommands = [];
          const recorded = commands.filter((command) => command.transient !== true);
          if (recorded.length > 0) {
            history.push({
              txId: frame.txId,
              label: frame.label,
              commands: recorded,
              timestamp: recorded[0]?.timestamp ?? Date.now(),
            });
          }
          // No extra notification here: every command already streamed one, and
          // a duplicate would make subscribers repaint for nothing.
        }
        return result;
      } catch (error) {
        // Atomicity: a transaction that throws leaves no trace, including for
        // nested transactions that rethrow into an outer one.
        const rolledBack = txCommands.slice(frame.startIndex);
        if (rolledBack.length > 0) {
          let restored = scene;
          for (let i = rolledBack.length - 1; i >= 0; i -= 1) {
            const command = rolledBack[i];
            if (command) restored = applyPatch(restored, command.inverse);
          }
          scene = restored;
        }
        txCommands = txCommands.slice(0, frame.startIndex);
        const depth = frames.indexOf(frame);
        if (depth >= 0) frames.splice(depth, 1);
        if (frames.length === 0) {
          txCommands = [];
          notify([], 'local', `${frame.label} (rolled back)`);
        }
        throw error;
      }
    },

    undo(): boolean {
      const entry: HistoryEntry | null = history.takeUndo();
      if (!entry) return false;
      scene = undoEntry(scene, entry);
      notify(entry.commands, 'undo', entry.label);
      return true;
    },

    redo(): boolean {
      const entry: HistoryEntry | null = history.takeRedo();
      if (!entry) return false;
      scene = redoEntry(scene, entry);
      notify(entry.commands, 'redo', entry.label);
      return true;
    },

    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    historyDepth: () => {
      const snapshot = history.inspect();
      return { undo: snapshot.undo.length, redo: snapshot.redo.length, limit: snapshot.limit };
    },

    reset(next: Scene): void {
      scene = next;
      history.clear();
      notify([], 'local', 'reset');
    },

    scene: {
      getState: () => scene,
      transaction: <T,>(
        fn: (handle: SceneHandle, tx: TransactionContext) => T,
        transactionOptions?: TransactionOptions,
      ): T => store.transaction(fn, transactionOptions),
    },
  };

  return store;
}

/** Alias kept for readability at call sites: `const scene = createSceneStore()`. */
export const createSceneStore = createStore;
