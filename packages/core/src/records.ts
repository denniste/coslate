import { createCommand, type Command } from './command.js';
import { newId } from './ids.js';
import { joinPath, parsePath, type JSONPatchOp } from './jsonpatch.js';
import type { Id, Scene, SceneObject } from './types.js';

/**
 * Records: the wire format for sharing a scene.
 *
 * A scene travels as **object state**, never as patches. That single choice is
 * what makes the protocol safe to run over a data channel that reconnects,
 * retries and occasionally delivers the same message twice:
 *
 * - **Idempotent.** Upserting the same object states N times is the same as
 *   upserting them once. Patch replay is not: replaying `add /order/-` appends a
 *   second copy of the id, after which the document fails its own validation and
 *   the whole scene is unloadable. That was a real defect, not a hypothetical.
 * - **No inverse on the wire.** Commands carry their inverses so undo is derived;
 *   an inverse in a hostile client's hands is a rollback primitive. Records carry
 *   none.
 * - **No patch surface.** A peer cannot address `/viewport`, `/meta`, or a path
 *   that does not exist yet — the receiver builds the ops itself, from state it
 *   validated.
 * - **Last-write-wins falls out.** "The newest state of object X" is a value, and
 *   values are trivially orderable by arrival.
 *
 * The outbound half is {@link recordsFromCommands}: a host listens to the store's
 * change stream, ignores anything that did not originate locally (that is the
 * echo guard), and hands the local commands here to get a delta. The inbound half
 * is {@link applyDelta} / {@link deltaToCommands}.
 */

/**
 * A batch of changes, shaped like the `{added, updated, removed}` ops message the
 * first host application already speaks.
 *
 * `added` and `updated` are both **upserts** — the distinction is a hint for
 * logging and for receivers that want to know what is new, never a difference in
 * how they are applied.
 */
export interface SceneDelta {
  added?: readonly SceneObject[];
  updated?: readonly SceneObject[];
  removed?: readonly Id[];
  /**
   * Authoritative paint order, sent when the sender changed it. Omitted order
   * leaves the receiver's own order alone, apart from appending new ids and
   * dropping removed ones.
   */
  order?: readonly Id[];
}

export interface DeltaOptions {
  /** Command source recorded on the receiving store. Defaults to `'api'`. */
  source?: Command['source'];
  /** Human-readable label for the delta. Defaults to `'remote'`. */
  label?: string;
}

const OBJECTS = '/objects/';

/** Decode one JSON-pointer token; `id` may contain `/` in a hostile payload. */
function tokenAt(path: string, index: number): string | null {
  let tokens: string[];
  try {
    tokens = parsePath(path).map(String);
  } catch {
    return null;
  }
  return tokens[index] ?? null;
}

function isRecordValue(value: unknown): value is SceneObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as SceneObject).id === 'string' &&
    typeof (value as SceneObject).type === 'string'
  );
}

/**
 * Check an untrusted delta, returning a delta that is safe to apply.
 *
 * Structurally unusable entries are dropped rather than thrown on: a peer sending
 * nonsense must not take the room down, and a drop is observable (the caller
 * compares the result with the input). Returns `null` when nothing usable is left.
 */
export function normalizeDelta(input: unknown): SceneDelta | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  const added: SceneObject[] = [];
  const updated: SceneObject[] = [];
  const removed: Id[] = [];

  for (const key of ['added', 'updated'] as const) {
    const list = raw[key];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) return null;
    for (const entry of list) {
      if (isRecordValue(entry)) (key === 'added' ? added : updated).push(entry);
    }
  }

  const removedRaw = raw.removed;
  if (removedRaw !== undefined && removedRaw !== null) {
    if (!Array.isArray(removedRaw)) return null;
    for (const entry of removedRaw) {
      if (typeof entry === 'string') removed.push(entry);
      else if (typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string') {
        removed.push((entry as { id: string }).id);
      }
    }
  }

  let order: Id[] | undefined;
  if (Array.isArray(raw.order)) {
    order = raw.order.filter((entry): entry is Id => typeof entry === 'string');
  }

  if (added.length === 0 && updated.length === 0 && removed.length === 0 && order === undefined) return null;
  const delta: SceneDelta = {};
  if (added.length > 0) delta.added = added;
  if (updated.length > 0) delta.updated = updated;
  if (removed.length > 0) delta.removed = removed;
  if (order !== undefined) delta.order = order;
  return delta;
}

export function isEmptyDelta(delta: SceneDelta | null): boolean {
  if (!delta) return true;
  return (
    (delta.added?.length ?? 0) === 0 &&
    (delta.updated?.length ?? 0) === 0 &&
    (delta.removed?.length ?? 0) === 0 &&
    delta.order === undefined
  );
}

/**
 * Renumber the denormalised `z` mirror to match `order`, sharing untouched records.
 *
 * Starts from `objects` and only rewrites `z`, so a record can never be dropped by
 * an order list that happens to omit it.
 */
function withOrder(scene: Scene, objects: Record<Id, SceneObject>, order: readonly Id[]): Scene {
  const renumbered: Record<Id, SceneObject> = { ...objects };
  order.forEach((id, index) => {
    const record = renumbered[id];
    if (record && record.z !== index) renumbered[id] = { ...record, z: index };
  });
  return { ...scene, objects: renumbered, order: [...order] };
}

/**
 * Content equality for two records.
 *
 * Reference equality is not enough: a message that comes back over a data channel
 * has been through `JSON.parse`, so a replay arrives as *new instances* holding
 * the same state. Comparing content is what makes "the same message twice" a
 * genuine no-op rather than a redundant replace (which would wake every renderer
 * and every listener for nothing). Records are plain JSON by contract, so
 * serializing them is exact.
 */
function sameRecord(a: SceneObject | undefined, b: SceneObject): boolean {
  if (a === b) return true;
  if (a === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Apply a delta to a scene, purely.
 *
 * Returns the **same scene reference** when the delta changes nothing, which is
 * what makes replay detection cheap: `applyDelta(applyDelta(s, d), d) === applyDelta(s, d)`.
 * Untouched objects keep their references (structural sharing), so a renderer
 * diffing by identity still sees only what moved.
 */
export function applyDelta(scene: Scene, delta: SceneDelta): Scene {
  const objects: Record<Id, SceneObject> = { ...scene.objects };
  let order: Id[] = [...scene.order];
  let changed = false;

  for (const record of [...(delta.added ?? []), ...(delta.updated ?? [])]) {
    if (sameRecord(objects[record.id], record)) continue;
    objects[record.id] = record;
    changed = true;
    if (!order.includes(record.id)) order.push(record.id);
  }

  const removed = new Set(delta.removed ?? []);
  if (removed.size > 0) {
    for (const id of removed) {
      if (id in objects) {
        delete objects[id];
        changed = true;
      }
    }
    const next = order.filter((id) => !removed.has(id));
    if (next.length !== order.length) {
      order = next;
      changed = true;
    }
  }

  if (delta.order !== undefined) {
    const known = new Set(order);
    const next: Id[] = [];
    const seen = new Set<Id>();
    for (const id of delta.order) {
      if (known.has(id) && !seen.has(id)) {
        next.push(id);
        seen.add(id);
      }
    }
    // Anything the sender did not mention keeps its relative place: a partial
    // order list must not silently delete objects from the paint order.
    for (const id of order) if (!seen.has(id)) next.push(id);
    if (next.join('|') !== order.join('|')) {
      order = next;
      changed = true;
    }
  }

  if (!changed) return scene;
  return withOrder(scene, objects, order);
}

/**
 * The minimal ops that turn `scene` into `applyDelta(scene, delta)`.
 *
 * Derived from the delta's *result* rather than from the delta itself, which is
 * why a replay produces an empty op list instead of a duplicate `add`.
 */
export function deltaToOps(scene: Scene, delta: SceneDelta): JSONPatchOp[] {
  const next = applyDelta(scene, delta);
  if (next === scene) return [];
  const ops: JSONPatchOp[] = [];

  for (const id of Object.keys(scene.objects)) {
    if (!(id in next.objects)) ops.push({ op: 'remove', path: joinPath('/objects', id) });
  }
  for (const [id, record] of Object.entries(next.objects)) {
    if (scene.objects[id] === record) continue;
    const path = joinPath('/objects', id);
    ops.push({ op: id in scene.objects ? 'replace' : 'add', path, value: record });
  }
  if (scene.order.join('|') !== next.order.join('|')) {
    ops.push({ op: 'replace', path: '/order', value: [...next.order] });
  }
  return ops;
}

/**
 * Wrap a delta in **one** command.
 *
 * One command means one patch, and one patch applies atomically: if any op fails,
 * the store never assigns the half-built scene. A delta therefore either lands
 * completely or not at all, which is what stops two peers from diverging after a
 * malformed frame.
 */
export function deltaToCommands(scene: Scene, delta: SceneDelta, options: DeltaOptions = {}): Command | null {
  const ops = deltaToOps(scene, delta);
  if (ops.length === 0) return null;
  return createCommand(scene, {
    type: 'remote.ops',
    patch: ops,
    source: options.source ?? 'api',
    label: options.label ?? 'remote',
  });
}

/**
 * The command that puts a delta back, for a host that applied one optimistically
 * and needs to roll it back.
 *
 * The inverse of the inverse is the original patch, so it is swapped rather than
 * recomputed: recomputing would need the *post*-delta document, which is exactly
 * what a caller in this situation does not have.
 */
export function deltaToInverseCommands(scene: Scene, delta: SceneDelta, options: DeltaOptions = {}): Command | null {
  const command = deltaToCommands(scene, delta, options);
  if (!command) return null;
  return { ...command, id: newId('cmd'), patch: command.inverse, inverse: command.patch };
}

/**
 * Turn locally-originated commands into a delta for the wire.
 *
 * Reads the *patch paths* rather than the command `type`: `type` is a free-form
 * label a host may invent, while the paths are the actual contract. Anything that
 * does not address `/objects/...` or `/order...` — a camera move, a meta edit, a
 * future field — is simply not broadcast.
 *
 * Returns `null` when there is nothing to send, so a caller can `if (!delta) return`.
 */
export function recordsFromCommands(scene: Scene, commands: readonly Command[]): SceneDelta | null {
  const created = new Set<Id>();
  const touched = new Set<Id>();
  const removed = new Set<Id>();
  let orderTouched = false;

  for (const command of commands) {
    if (command.transient === true) continue;
    for (const op of command.patch) {
      if (op.path === '/order' || op.path.startsWith('/order/')) {
        orderTouched = true;
        continue;
      }
      if (!op.path.startsWith(OBJECTS)) continue;
      const id = tokenAt(op.path, 1);
      if (id === null) continue;
      const isWholeObject = op.path === joinPath('/objects', id);
      if (op.op === 'remove' && isWholeObject) {
        removed.add(id);
        created.delete(id);
        touched.delete(id);
        continue;
      }
      if (op.op === 'add' && isWholeObject) created.add(id);
      if (!removed.has(id)) touched.add(id);
    }
  }

  const added: SceneObject[] = [];
  const updated: SceneObject[] = [];
  for (const id of touched) {
    const record = scene.objects[id];
    if (!record) continue;
    (created.has(id) ? added : updated).push(record);
  }
  for (const id of [...removed]) if (id in scene.objects) removed.delete(id);

  const delta: SceneDelta = {};
  if (added.length > 0) delta.added = added;
  if (updated.length > 0) delta.updated = updated;
  if (removed.size > 0) delta.removed = [...removed];
  if (orderTouched) delta.order = [...scene.order];
  return isEmptyDelta(delta) ? null : delta;
}

/**
 * Content equality for {@link diffScenes} — like {@link sameRecord} but
 * ignoring the `z` mirror.
 *
 * `z` is a denormalised mirror of the paint order, and local creation does not
 * renumber it (a freshly made object carries `z: 0` at whatever order index it
 * lands). Two scenes that agree on content and order but whose mirrors are
 * stale in different ways are the *same* scene for baseline purposes — carrying
 * that noise in a diff would break the "already converged is a free no-op"
 * guarantee, and `applyDelta` renumbers the mirrors anyway whenever it applies
 * anything.
 */
function sameRecordContent(a: SceneObject | undefined, b: SceneObject): boolean {
  if (a === b) return true;
  if (a === undefined) return false;
  const { z: _ignoredA, ...restA } = a;
  const { z: _ignoredB, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

/**
 * Compute the delta that turns `from` into `to` — the same {@link SceneDelta}
 * shape the wire uses, so a whole document (a stored baseline, a snapshot
 * reply) can travel the *identical* apply path as ordinary peer updates:
 * idempotent, atomic, and never an undo step.
 *
 * `added` and `updated` follow the wire convention (both upserts; the split is
 * a hint). `order` is carried as the full target order whenever the two orders
 * differ — `applyDelta` treats an order list as authoritative, so a partial
 * list could not express removals from the paint order.
 *
 * Returns `null` when the scenes are equal — "nothing to send", the convention
 * of {@link recordsFromCommands} — which is what makes a baseline poll that
 * finds the document already converged a free no-op.
 */
export function diffScenes(from: Scene, to: Scene): SceneDelta | null {
  const added: SceneObject[] = [];
  const updated: SceneObject[] = [];
  for (const [id, record] of Object.entries(to.objects)) {
    const current = from.objects[id];
    if (current === undefined) added.push(record);
    else if (!sameRecordContent(current, record)) updated.push(record);
  }
  const removed: Id[] = [];
  for (const id of Object.keys(from.objects)) {
    if (!(id in to.objects)) removed.push(id);
  }
  const orderChanged = from.order.join('|') !== to.order.join('|');
  if (added.length === 0 && updated.length === 0 && removed.length === 0 && !orderChanged) return null;

  const delta: SceneDelta = {};
  if (added.length > 0) delta.added = added;
  if (updated.length > 0) delta.updated = updated;
  if (removed.length > 0) delta.removed = removed;
  if (orderChanged) delta.order = [...to.order];
  return delta;
}

/**
 * Whether a change event should be broadcast.
 *
 * The echo guard excludes exactly one origin: `remote`. Undo and redo are *local*
 * edits — pressing Ctrl+Z has to be visible to everyone else, or the room
 * disagrees about the document. What stops an undo from eating a peer's work is
 * not this filter but the fact that remote commands never enter the local
 * history, so a local undo can only ever revert local commands.
 *
 * Transient commands never travel: they are the ones that exist for local
 * feedback only.
 */
export function shouldBroadcast(event: { origin: string; commands: readonly Command[] }): boolean {
  if (event.origin === 'remote') return false;
  return event.commands.some((command) => command.transient !== true);
}
