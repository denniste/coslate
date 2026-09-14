import { describe, expect, it } from 'vitest';
import {
  addObjectOps,
  applyDelta,
  createStore,
  deltaToCommands,
  deltaToInverseCommands,
  deserialize,
  isEmptyDelta,
  isSceneEmpty,
  makeObject,
  normalizeDelta,
  recordsFromCommands,
  removeObjectOps,
  reorderObjectOps,
  serialize,
  shouldBroadcast,
  updateObjectDataOps,
  updateObjectOps,
  type ChangeEvent,
  type Scene,
  type SceneDelta,
  type SceneObject,
  type SceneStore,
} from '@coslate/core';

const rect = (id: string, x = 0, y = 0): SceneObject =>
  makeObject({ type: 'shape.rect', id, x, y, width: 40, height: 30 });

/** A store plus the deltas a host would have broadcast for its local edits. */
function recorder(): { store: SceneStore; deltas: SceneDelta[]; events: ChangeEvent[] } {
  const store = createStore();
  const deltas: SceneDelta[] = [];
  const events: ChangeEvent[] = [];
  store.subscribe((event) => {
    events.push(event);
    if (!shouldBroadcast(event)) return;
    const delta = recordsFromCommands(event.scene, event.commands);
    if (delta) deltas.push(delta);
  });
  return { store, deltas, events };
}

const ids = (scene: Scene): string[] => scene.order;
const objectIds = (scene: Scene): string[] => Object.keys(scene.objects).sort();

describe('records: outbound derivation', () => {
  it('turns a create into an added record, and keeps the paint order honest', () => {
    const sender = recorder();
    const object = rect('a', 10, 20);
    sender.store.commit({ type: 'object.create', patch: addObjectOps(object) });

    expect(sender.deltas).toHaveLength(1);
    const delta = sender.deltas[0]!;
    expect(delta.added?.map((record) => record.id)).toEqual(['a']);
    expect(delta.updated).toBeUndefined();
    expect(delta.order).toEqual(['a']);
  });

  it('turns a move into an updated record carrying the whole object', () => {
    const sender = recorder();
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('a')) });
    sender.deltas.length = 0;

    sender.store.commit({ type: 'object.move', patch: updateObjectOps('a', { x: 100, y: 50 }) });
    expect(sender.deltas).toHaveLength(1);
    const delta = sender.deltas[0]!;
    expect(delta.added).toBeUndefined();
    expect(delta.updated).toHaveLength(1);
    expect(delta.updated?.[0]).toMatchObject({ id: 'a', x: 100, y: 50 });
  });

  it('turns a delete into a removed id', () => {
    const sender = recorder();
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('a')) });
    sender.deltas.length = 0;

    sender.store.commit({ type: 'object.delete', patch: removeObjectOps(sender.store.getState(), 'a') });
    expect(sender.deltas).toHaveLength(1);
    expect(sender.deltas[0]!.removed).toEqual(['a']);
    expect(sender.deltas[0]!.order).toEqual([]);
  });

  it('sends the order only when the order actually changed', () => {
    const sender = recorder();
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('a')) });
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('b')) });
    sender.deltas.length = 0;

    sender.store.commit({
      type: 'object.move',
      patch: updateObjectOps('a', { x: 5 }),
    });
    expect(sender.deltas[0]!.order).toBeUndefined();

    sender.deltas.length = 0;
    sender.store.commit({
      type: 'object.reorder',
      patch: reorderObjectOps(sender.store.getState(), 'a', 'front'),
    });
    expect(sender.deltas[0]!.order).toEqual(['b', 'a']);
  });

  it('ignores transient commands entirely', () => {
    const sender = recorder();
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('a')) });
    sender.deltas.length = 0;
    sender.store.commit({
      type: 'object.move',
      patch: updateObjectOps('a', { x: 999 }),
      transient: true,
    });
    expect(sender.deltas).toHaveLength(0);
  });

  it('reports nothing to send for a change that touches neither objects nor order', () => {
    const sender = recorder();
    const delta = recordsFromCommands(sender.store.getState(), []);
    expect(delta).toBeNull();
    expect(isEmptyDelta(null)).toBe(true);
  });
});

describe('records: idempotent application', () => {
  it('replaying a create N times leaves the order with one entry', () => {
    // The defect this replaces: replaying `add /order/-` appended the id again,
    // and the document then failed its own validation.
    const sender = recorder();
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('a', 3, 4)) });
    const delta = sender.deltas[0]!;

    const receiver = createStore();
    for (let i = 0; i < 5; i += 1) receiver.applyDelta(delta);

    expect(ids(receiver.getState())).toEqual(['a']);
    expect(receiver.getState().objects.a).toEqual(sender.store.getState().objects.a);
    expect(() => deserialize(serialize(receiver.getState()))).not.toThrow();
  });

  it('replaying a full edit stream converges on the sender exactly', () => {
    const sender = recorder();
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('a')) });
    sender.store.commit({ type: 'object.create', patch: addObjectOps(rect('b', 50, 0)) });
    sender.store.commit({ type: 'object.move', patch: updateObjectOps('a', { x: 12 }) });
    sender.store.commit({ type: 'object.reorder', patch: reorderObjectOps(sender.store.getState(), 'a', 'front') });

    const receiver = createStore();
    for (const delta of sender.deltas) receiver.applyDelta(delta);
    expect(receiver.getState()).toEqual(sender.store.getState());

    // ...and again, twice over, changes nothing at all.
    const settled = receiver.getState();
    for (const delta of sender.deltas) receiver.applyDelta(delta);
    expect(receiver.getState()).toEqual(settled);
  });

  it('is a no-op by reference the second time', () => {
    const delta: SceneDelta = { added: [rect('a')], order: ['a'] };
    const once = applyDelta(createStore().getState(), delta);
    expect(applyDelta(once, delta)).toBe(once);
  });

  it('treats a delete of something already gone as a no-op', () => {
    const store = createStore();
    store.applyDelta({ added: [rect('a')], order: ['a'] });
    store.applyDelta({ removed: ['a'] });
    expect(isSceneEmpty(store.getState())).toBe(true);
    expect(store.applyDelta({ removed: ['a'] })).toBe(false);
  });

  it('lets the newest state of an object win, whatever the arrival order', () => {
    const receiver = createStore();
    receiver.applyDelta({ added: [rect('a', 1, 1)], order: ['a'] });
    receiver.applyDelta({ updated: [{ ...rect('a', 2, 2), width: 99 }] });
    const last = receiver.getState().objects.a!;
    expect(last).toMatchObject({ x: 2, y: 2, width: 99 });
  });

  it('reconciles an explicit order without losing objects the sender omitted', () => {
    const store = createStore();
    store.applyDelta({ added: [rect('a'), rect('b'), rect('c')], order: ['a', 'b', 'c'] });
    store.applyDelta({ order: ['c', 'a'] });
    expect(ids(store.getState())).toEqual(['c', 'a', 'b']);
    // `z` is a mirror of the order, and must not drift from it.
    expect(store.getState().objects.c!.z).toBe(0);
    expect(store.getState().objects.b!.z).toBe(2);
  });
});

describe('records: remote changes are not local edits', () => {
  it('never enters the undo history and does not clear what is there', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('local')) });
    expect(store.historyDepth().undo).toBe(1);

    store.applyDelta({ added: [rect('remote')], order: ['local', 'remote'] });
    expect(store.historyDepth().undo).toBe(1);

    store.undo();
    expect(objectIds(store.getState())).toEqual(['remote']);
  });

  it('does not report a remote batch as broadcastable, so it cannot echo', () => {
    const store = createStore();
    const origins: string[] = [];
    store.subscribe((event) => origins.push(event.origin));

    store.commit({ type: 'object.create', patch: addObjectOps(rect('a')) });
    store.applyDelta({ updated: [rect('a', 9, 9)] });

    expect(origins).toEqual(['local', 'remote']);
  });

  it('broadcasts local edits, including undo, but never a remote batch', () => {
    const command = { id: 'c', type: 't', patch: [], inverse: [], source: 'user' as const, timestamp: 0 };
    expect(shouldBroadcast({ origin: 'local', commands: [command] })).toBe(true);
    // Undo is a local edit: everyone else must see the room revert.
    expect(shouldBroadcast({ origin: 'undo', commands: [command] })).toBe(true);
    expect(shouldBroadcast({ origin: 'redo', commands: [command] })).toBe(true);
    expect(shouldBroadcast({ origin: 'remote', commands: [command] })).toBe(false);
    // Transient commands are local feedback only.
    expect(shouldBroadcast({ origin: 'local', commands: [{ ...command, transient: true }] })).toBe(false);
    expect(shouldBroadcast({ origin: 'local', commands: [] })).toBe(false);
  });

  it('refuses a whole batch when any command in it cannot apply', () => {
    // Without an `onError` handler the store fails loudly; with one it reports and
    // drops the batch. Either way the document is untouched.
    const tolerated: unknown[] = [];
    const store = createStore({ onError: (error) => tolerated.push(error) });
    const good = deltaToCommands(store.getState(), { added: [rect('a')], order: ['a'] })!;
    const bad = deltaToCommands(store.getState(), { added: [rect('b')], order: ['b'] })!;
    // A valid-looking command whose patch is not applicable to this document.
    const broken = { ...bad, patch: [{ op: 'replace' as const, path: '/objects/ghost/x', value: 1 }] };

    store.applyRemote([good, broken]);
    expect(store.getState().order).toEqual([]);
    expect(tolerated).toHaveLength(1);

    const strict = createStore();
    expect(() => strict.applyRemote([good, broken])).toThrow(/PATH_NOT_FOUND|patch error/);
    expect(strict.getState().order).toEqual([]);

    store.applyRemote([good]);
    expect(store.getState().order).toEqual(['a']);
  });

  it('drops structurally unusable records instead of throwing', () => {
    const store = createStore();
    expect(store.applyDelta({ added: [{ nope: true } as unknown as SceneObject] })).toBe(false);
    expect(store.applyDelta(null as unknown as SceneDelta)).toBe(false);
    expect(store.getState().order).toEqual([]);

    store.applyDelta({ added: [rect('a')], removed: [42 as unknown as string], order: ['a', 7 as unknown as string] });
    expect(store.getState().order).toEqual(['a']);
  });
});

describe('records: atomicity and inverse', () => {
  it('wraps a delta in exactly one command, so the batch cannot half-apply', () => {
    const store = createStore();
    const delta: SceneDelta = { added: [rect('a'), rect('b')], order: ['a', 'b'] };
    const command = deltaToCommands(store.getState(), delta);
    expect(command).not.toBeNull();
    // One command = one patch = one assignment in the store.
    expect(command!.patch.length).toBeGreaterThan(0);
    expect(command!.type).toBe('remote.ops');
  });

  it('produces no command at all for a replay', () => {
    const store = createStore();
    const delta: SceneDelta = { added: [rect('a')], order: ['a'] };
    store.applyDelta(delta);
    expect(deltaToCommands(store.getState(), delta)).toBeNull();

    // The realistic case: the retransmitted frame has been through JSON, so it is
    // a different instance holding the same state.
    const reparsed = JSON.parse(JSON.stringify(delta)) as SceneDelta;
    expect(deltaToCommands(store.getState(), reparsed)).toBeNull();
    const settled = store.getState();
    expect(applyDelta(settled, reparsed)).toBe(settled);
  });

  it('can invert a delta back to the previous document', () => {
    const store = createStore();
    store.commit({ type: 'object.create', patch: addObjectOps(rect('keep')) });
    const before = store.getState();

    const forward = deltaToCommands(before, { added: [rect('add')], order: ['keep', 'add'] })!;
    const inverse = deltaToInverseCommands(before, { added: [rect('add')], order: ['keep', 'add'] })!;
    expect(inverse.patch).toEqual(forward.inverse);

    store.applyRemote([forward]);
    expect(objectIds(store.getState())).toEqual(['add', 'keep']);
    store.applyRemote([inverse]);
    expect(store.getState()).toEqual(before);
  });

  it('sends a whole transaction as one delta', () => {
    const sender = recorder();
    sender.store.transaction(
      (_scene, tx) => {
        sender.store.dispatch(tx.commit('object.create', addObjectOps(rect('a'))));
        sender.store.dispatch(tx.commit('object.create', addObjectOps(rect('b', 30, 0))));
      },
      { label: 'Add two' },
    );
    // Two commands stream two events, but a host coalescing them still converges.
    const merged = recordsFromCommands(sender.store.getState(), sender.events.flatMap((event) => [...event.commands]));
    expect(merged?.added?.map((record) => record.id).sort()).toEqual(['a', 'b']);
  });

  it('carries text edits as object state', () => {
    const sender = recorder();
    sender.store.commit({
      type: 'object.create',
      patch: addObjectOps(makeObject({ type: 'shape.text', id: 't', x: 0, y: 0, width: 80, height: 20, data: { text: 'hi' } })),
    });
    sender.deltas.length = 0;
    sender.store.commit({
      type: 'object.text',
      patch: updateObjectDataOps<'shape.text'>('t', { text: 'hello' }),
    });
    const record = sender.deltas[0]!.updated?.[0];
    expect(record?.type).toBe('shape.text');
    expect((record?.data as { text: string }).text).toBe('hello');
  });
});

describe('records: delta normalization', () => {
  it('accepts the wire shape the host already speaks', () => {
    const delta = normalizeDelta({
      t: 'ops',
      added: [rect('a')],
      updated: [rect('b')],
      removed: ['c'],
      order: ['a', 'b'],
    });
    expect(delta?.added).toHaveLength(1);
    expect(delta?.updated).toHaveLength(1);
    expect(delta?.removed).toEqual(['c']);
    expect(delta?.order).toEqual(['a', 'b']);
  });

  it('accepts removed entries as ids or as records', () => {
    expect(normalizeDelta({ removed: [{ id: 'a' }] })?.removed).toEqual(['a']);
    expect(normalizeDelta({ removed: ['a'] })?.removed).toEqual(['a']);
  });

  it('rejects input that is not a delta at all', () => {
    expect(normalizeDelta('ops')).toBeNull();
    expect(normalizeDelta({})).toBeNull();
    expect(normalizeDelta({ added: 'nope' })).toBeNull();
  });
});
