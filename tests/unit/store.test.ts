import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addObjectOps,
  createEmptyScene,
  createStore,
  makeObject,
  removeObjectOps,
  reorderObjectOps,
  updateObjectOps,
  type ChangeEvent,
  type SceneStore,
} from '@coslate/core';

function rect(id: string, x: number, y: number): ReturnType<typeof makeObject> {
  return makeObject({ type: 'shape.rect', id, x, y, width: 100, height: 50 });
}

describe('store: basics', () => {
  let store: SceneStore;

  beforeEach(() => {
    store = createStore();
  });

  it('starts empty and applies commands immutably', () => {
    const before = store.getState();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    const after = store.getState();
    expect(before).not.toBe(after);
    expect(Object.keys(before.objects)).toHaveLength(0);
    expect(after.order).toEqual(['a']);
    expect(after.objects.a?.x).toBe(0);
  });

  it('notifies subscribers with the new scene and the commands', () => {
    const events: ChangeEvent[] = [];
    const unsubscribe = store.subscribe((event) => events.push(event));
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    store.commit({ type: 'object.update', patch: updateObjectOps('a', { x: 10 }) });
    unsubscribe();
    store.commit({ type: 'object.update', patch: updateObjectOps('a', { x: 20 }) });

    expect(events).toHaveLength(2);
    expect(events[0]?.origin).toBe('local');
    expect(events[1]?.scene.objects.a?.x).toBe(10);
    expect(store.getState().objects.a?.x).toBe(20);
  });

  it('computes the inverse so the command can undo itself', () => {
    const command = store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    expect(command.inverse.length).toBe(2);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getState().order).toEqual([]);
  });

  it('records one history entry per command outside a transaction', () => {
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    store.commit({ type: 'object.create', patch: addObjectOps(rect('b', 10, 10)) });
    expect(store.historyDepth().undo).toBe(2);
  });
});

describe('store: transactions', () => {
  let store: SceneStore;

  beforeEach(() => {
    store = createStore();
  });

  it('groups many commands into a single undo step', () => {
    store.transaction(
      (scene, tx) => {
        scene.getState();
        store.dispatch(tx.commit('object.create', addObjectOps(rect('a', 0, 0))));
        store.dispatch(tx.commit('object.create', addObjectOps(rect('b', 10, 10))));
        store.dispatch(tx.commit('object.create', addObjectOps(rect('c', 20, 20))));
      },
      { label: 'Paste 3 objects' },
    );

    expect(store.historyDepth().undo).toBe(1);
    expect(store.getState().order).toEqual(['a', 'b', 'c']);

    store.undo();
    expect(store.getState().order).toEqual([]);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(true);
  });

  it('streams change events per command but records a single history entry', () => {
    const listener = vi.fn();
    store.subscribe(listener);
    store.transaction((_scene, tx) => {
      store.dispatch(tx.commit('object.create', addObjectOps(rect('a', 0, 0))));
      store.dispatch(tx.commit('object.create', addObjectOps(rect('b', 1, 1))));
    });
    // Two events so tools get immediate feedback...
    expect(listener).toHaveBeenCalledTimes(2);
    // ...but one undo step, so Ctrl+Z does not walk back object by object.
    expect(store.historyDepth().undo).toBe(1);
  });

  it('flattens nested transactions into the outermost one', () => {
    store.transaction((_scene, outerTx) => {
      store.dispatch(outerTx.commit('object.create', addObjectOps(rect('a', 0, 0))));
      store.transaction((_innerScene, innerTx) => {
        store.dispatch(innerTx.commit('object.create', addObjectOps(rect('b', 0, 0))));
      });
      expect(store.historyDepth().undo).toBe(0);
    });
    expect(store.historyDepth().undo).toBe(1);
    store.undo();
    expect(store.getState().order).toEqual([]);
  });

  it('tags every command with the outer transaction id', () => {
    const seen: string[] = [];
    store.transaction((_scene, tx) => {
      seen.push(store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) }).txId ?? '');
      seen.push(tx.txId);
    });
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe('');
  });

  it('rolls back everything when the transaction body throws', () => {
    expect(() =>
      store.transaction((_scene, tx) => {
        store.dispatch(tx.commit('object.create', addObjectOps(rect('a', 0, 0))));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.getState().order).toEqual([]);
    expect(store.historyDepth().undo).toBe(0);
  });

  it('returns the callback value', () => {
    const value = store.transaction(() => 41 + 1);
    expect(value).toBe(42);
  });
});

describe('store: undo / redo ordering', () => {
  it('walks back and forward through the exact sequence of edits', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    store.commit({ type: 'object.update', patch: updateObjectOps('a', { x: 100 }) });
    store.commit({ type: 'object.update', patch: updateObjectOps('a', { x: 200 }) });

    expect(store.getState().objects.a?.x).toBe(200);

    store.undo();
    expect(store.getState().objects.a?.x).toBe(100);
    store.undo();
    expect(store.getState().objects.a?.x).toBe(0);
    store.undo();
    expect(store.getState().order).toEqual([]);
    expect(store.canUndo()).toBe(false);
    expect(store.undo()).toBe(false);

    expect(store.redo()).toBe(true);
    expect(store.getState().order).toEqual(['a']);
    store.redo();
    expect(store.getState().objects.a?.x).toBe(100);
    store.redo();
    expect(store.getState().objects.a?.x).toBe(200);
    expect(store.canRedo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('drops the redo branch when a new edit lands after an undo', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    store.commit({ type: 'object.update', patch: updateObjectOps('a', { x: 50 }) });
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.commit({ type: 'object.update', patch: updateObjectOps('a', { y: 5 }) });
    expect(store.canRedo()).toBe(false);
    expect(store.getState().objects.a?.x).toBe(0);
    expect(store.getState().objects.a?.y).toBe(5);
  });

  it('undoes a delete back into the original z-order slot', () => {
    const store = createStore();
    store.transaction((_scene, tx) => {
      for (const id of ['a', 'b', 'c']) {
        store.dispatch(tx.commit('object.create', addObjectOps(rect(id, 0, 0))));
      }
    });
    const scene = store.getState();
    store.commit({ type: 'object.delete', patch: removeObjectOps(scene, 'b') });
    expect(store.getState().order).toEqual(['a', 'c']);
    store.undo();
    expect(store.getState().order).toEqual(['a', 'b', 'c']);
  });

  it('restores z-order through a reorder command', () => {
    const store = createStore();
    store.transaction((_scene, tx) => {
      for (const id of ['a', 'b', 'c']) {
        store.dispatch(tx.commit('object.create', addObjectOps(rect(id, 0, 0))));
      }
    });
    store.commit({ type: 'object.reorder', patch: reorderObjectOps(store.getState(), 'a', 'front') });
    expect(store.getState().order).toEqual(['b', 'c', 'a']);
    expect(store.getState().objects.a?.z).toBe(2);
    store.undo();
    expect(store.getState().order).toEqual(['a', 'b', 'c']);
    expect(store.getState().objects.a?.z).toBe(0);
  });
});

describe('store: bounded history', () => {
  it('keeps at most `limit` undo steps and drops the oldest', () => {
    const store = createStore({ historyLimit: 5 });
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    for (let i = 1; i <= 9; i += 1) {
      store.commit({ type: 'object.update', patch: updateObjectOps('a', { x: i }) });
    }
    expect(store.historyDepth().undo).toBe(5);
    expect(store.historyDepth().limit).toBe(5);
    expect(store.getState().objects.a?.x).toBe(9);

    for (let i = 0; i < 5; i += 1) store.undo();
    expect(store.canUndo()).toBe(false);
    // The creation step fell off the end of the bounded stack, so the object
    // survives at the oldest retained value.
    expect(store.getState().objects.a?.x).toBe(4);
  });

  it('rejects a non-positive limit', () => {
    expect(() => createStore({ historyLimit: 0 })).toThrow(RangeError);
  });

  it('defaults to 200', () => {
    expect(createStore().historyDepth().limit).toBe(200);
  });
});

describe('store: applyRemote', () => {
  it('applies forward without touching the undo stack', () => {
    const store = createStore();
    const remote = createStore();
    const command = remote.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });

    store.applyRemote([command]);
    expect(store.getState().order).toEqual(['a']);
    expect(store.canUndo()).toBe(false);
    expect(store.historyDepth().undo).toBe(0);
  });

  it('clears the redo branch so redo cannot resurrect superseded state', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    store.undo();
    expect(store.canRedo()).toBe(true);
    const remote = createStore();
    store.applyRemote([remote.commit({ type: 'object.create', patch: addObjectOps(rect('z', 0, 0)) })]);
    expect(store.canRedo()).toBe(false);
    expect(store.getState().order).toEqual(['z']);
  });

  it('ignores malformed commands and keeps the session alive', () => {
    const errors: unknown[] = [];
    const store = createStore({ onError: (error) => errors.push(error) });
    store.applyRemote([{ nope: true } as never]);
    expect(errors).toHaveLength(1);
    expect(store.getState().order).toEqual([]);
  });
});

describe('store: transient commands', () => {
  it('applies transient commands without recording an undo step', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    store.commit({
      type: 'object.move',
      patch: [{ op: 'replace', path: '/objects/a/x', value: 400 }],
      transient: true,
    });
    expect(store.getState().objects.a!.x).toBe(400);
    expect(store.historyDepth().undo).toBe(1);

    // Undo skips the transient edit and reverts the content edit.
    store.undo();
    expect(store.getState().order).toEqual([]);
  });

  it('does not create a history entry for an all-transient transaction', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    store.transaction((_scene, tx) => {
      store.dispatch(tx.commit('object.move', [{ op: 'replace', path: '/objects/a/x', value: 10 }], { transient: true }));
      store.dispatch(tx.commit('object.move', [{ op: 'replace', path: '/objects/a/y', value: 20 }], { transient: true }));
    });
    expect(store.getState().objects.a!.x).toBe(10);
    expect(store.getState().objects.a!.y).toBe(20);
    // Only the create is undoable; the transient pair added no step of its own.
    store.undo();
    expect(store.getState().order).toEqual([]);
  });
});

describe('store: reset', () => {
  it('replaces the document and clears history', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 0, 0)) });
    const fresh = createEmptyScene();
    store.reset(fresh);
    expect(store.getState()).toBe(fresh);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });
});

describe('store: scene handle', () => {
  it('exposes transaction through store.scene as well', () => {
    const store = createStore();
    store.scene.transaction((_scene, tx) => {
      store.dispatch(tx.commit('object.create', addObjectOps(rect('a', 0, 0))));
      store.dispatch(tx.commit('object.create', addObjectOps(rect('b', 0, 0))));
    });
    expect(store.historyDepth().undo).toBe(1);
    expect(store.getState().order).toEqual(['a', 'b']);
  });
});

describe('store: applyDelta error reporting (O1)', () => {
  /** `createStore` types the input as `SceneDelta`; the corrupt cases are not. */
  const bad = (value: unknown): Parameters<SceneStore['applyDelta']>[0] => value as never;

  it('reports a corrupt frame through onError, changes nothing, and never throws', () => {
    const errors: [unknown, string][] = [];
    const store = createStore({ onError: (error, context) => errors.push([error, context]) });
    const object = rect('peer', 0, 0);
    const delta = { added: [object], order: [object.id] };

    expect(store.applyDelta(delta)).toBe(true);

    // Not an object at all; a field that should be an array; entries nothing
    // could apply. All three are corruption: the sender got the payload wrong,
    // and a host counting dropped frames has to hear about each one.
    expect(store.applyDelta(bad(null))).toBe(false);
    expect(store.applyDelta(bad({ added: 42 }))).toBe(false);
    expect(store.applyDelta(bad({ added: [{ garbage: true }] }))).toBe(false);

    expect(errors).toHaveLength(3);
    for (const [error, context] of errors) {
      expect(error).toBeInstanceOf(TypeError);
      expect(context).toBe('applyDelta');
    }
    // The corrupt frames changed nothing and left no history.
    expect(store.getState().order).toEqual(['peer']);
    expect(store.canUndo()).toBe(false);
  });

  it('never reports a duplicate frame, and an empty frame is a benign no-op', () => {
    const errors: unknown[] = [];
    const store = createStore({ onError: (error) => errors.push(error) });
    const object = rect('peer', 0, 0);
    const delta = { added: [object], order: [object.id] };

    expect(store.applyDelta(delta)).toBe(true);
    // Replays are idempotence working as designed, not errors; a frame that is
    // well-shaped but carries nothing is ordinary transport noise.
    for (let i = 0; i < 3; i += 1) expect(store.applyDelta(delta)).toBe(false);
    expect(store.applyDelta(bad({}))).toBe(false);
    expect(store.applyDelta(bad({ added: [] }))).toBe(false);
    expect(errors).toHaveLength(0);
    expect(store.getState().order).toEqual(['peer']);
  });

  it('stays silent and keeps R4 when the host supplied no onError', () => {
    const store = createStore();
    expect(store.applyDelta(bad(null))).toBe(false);
    expect(store.applyDelta(bad({ added: 42 }))).toBe(false);
    expect(store.getState().order).toEqual([]);
  });
});
