/**
 * A minimal, dependency-free JSON Patch engine (RFC 6902 subset).
 *
 * CoSlate deliberately does not depend on a patch library. The command
 * protocol is the spine of the whole project — undo, and later remote sync, are
 * both defined in terms of it — so it stays small, auditable and ours.
 *
 * Supported operations: `add`, `replace`, `remove`.
 * Supported paths: `/objects/<id>/x`, `/order/-` (append), `/order/3` (insert),
 * plus the empty path `""` meaning "the whole document".
 *
 * Every mutation is *immutable*: untouched sub-trees are shared by reference,
 * which is what makes the store cheap to diff and cheap to render from.
 */

export type PatchOpKind = 'add' | 'replace' | 'remove';

export interface JSONPatchOp {
  op: PatchOpKind;
  /** RFC 6901 JSON Pointer, e.g. `/objects/obj_1/x`. */
  path: string;
  /**
   * Payload for `add` / `replace`. Typed `unknown` on purpose: a patch is
   * untrusted input as soon as it crosses a process boundary, so consumers must
   * narrow it rather than assume a shape.
   */
  value?: unknown;
}

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };

export type PatchErrorCode =
  | 'INVALID_PATH'
  | 'PATH_NOT_FOUND'
  | 'TYPE_MISMATCH'
  | 'INVALID_OP'
  | 'MISSING_VALUE';

export class PatchError extends Error {
  public readonly code: PatchErrorCode;
  public readonly path: string;

  constructor(code: PatchErrorCode, path: string, message: string) {
    super(`CoSlate patch error (${code}) at "${path}": ${message}`);
    this.name = 'PatchError';
    this.code = code;
    this.path = path;
  }
}

export type PathToken = string | number;

function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Parse an RFC 6901 pointer into tokens. `""` yields `[]` (the root). */
export function parsePath(path: string): PathToken[] {
  if (path === '') return [];
  if (!path.startsWith('/')) {
    throw new PatchError('INVALID_PATH', path, 'pointer must start with "/" or be empty');
  }
  return path
    .slice(1)
    .split('/')
    .map((raw) => unescapeToken(raw));
}

/** Render tokens back into an RFC 6901 pointer. */
export function formatPath(tokens: readonly PathToken[]): string {
  if (tokens.length === 0) return '';
  return `/${tokens.map((t) => escapeToken(String(t))).join('/')}`;
}

/** Append a token to a pointer, e.g. `joinPath('/order', '-')`. */
export function joinPath(base: string, ...tokens: PathToken[]): string {
  return formatPath([...parsePath(base), ...tokens]);
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

function shallowClone(container: Record<string, unknown> | unknown[]): Record<string, unknown> | unknown[] {
  return Array.isArray(container) ? container.slice() : { ...container };
}

function childOf(container: unknown, token: PathToken, path: string): unknown {
  if (Array.isArray(container)) {
    if (token === '-') {
      throw new PatchError('PATH_NOT_FOUND', path, '"-" is only valid as the last token of an add');
    }
    const index = typeof token === 'number' ? token : Number(token);
    if (!Number.isInteger(index) || index < 0 || index >= container.length) {
      throw new PatchError('PATH_NOT_FOUND', path, `array index ${String(token)} out of range`);
    }
    return container[index];
  }
  if (isContainer(container)) {
    const key = String(token);
    if (!Object.prototype.hasOwnProperty.call(container, key)) {
      throw new PatchError('PATH_NOT_FOUND', path, `no such key "${key}"`);
    }
    return (container as Record<string, unknown>)[key];
  }
  throw new PatchError('TYPE_MISMATCH', path, `cannot descend into ${typeof container}`);
}

/** Read the value at `path`. Throws {@link PatchError} when it does not exist. */
export function getAtPath(document: unknown, path: string): unknown {
  const tokens = parsePath(path);
  let cursor: unknown = document;
  for (const token of tokens) {
    cursor = childOf(cursor, token, path);
  }
  return cursor;
}

/** Non-throwing existence check, used when computing inverses. */
export function hasAtPath(document: unknown, path: string): boolean {
  try {
    getAtPath(document, path);
    return true;
  } catch {
    return false;
  }
}

function writeAt(
  node: unknown,
  tokens: readonly PathToken[],
  path: string,
  value: unknown,
  mode: 'add' | 'replace',
): unknown {
  const head = tokens[0];
  if (head === undefined) return value;
  if (!isContainer(node)) {
    throw new PatchError('TYPE_MISMATCH', path, `cannot write into ${node === null ? 'null' : typeof node}`);
  }
  const clone = shallowClone(node);
  const rest = tokens.slice(1);

  if (rest.length > 0) {
    const next = childOf(node, head, path);
    const updated = writeAt(next, rest, path, value, mode);
    if (Array.isArray(clone)) clone[Number(head)] = updated;
    else (clone as Record<string, unknown>)[String(head)] = updated;
    return clone;
  }

  if (Array.isArray(clone)) {
    if (head === '-') {
      if (mode === 'replace') {
        throw new PatchError('INVALID_OP', path, '"-" cannot be used with replace');
      }
      clone.push(value);
      return clone;
    }
    const index = typeof head === 'number' ? head : Number(head);
    if (!Number.isInteger(index) || index < 0) {
      throw new PatchError('INVALID_PATH', path, `bad array index ${String(head)}`);
    }
    if (mode === 'add') {
      if (index > clone.length) {
        throw new PatchError('PATH_NOT_FOUND', path, `index ${index} past end of array`);
      }
      clone.splice(index, 0, value);
    } else {
      if (index >= clone.length) {
        throw new PatchError('PATH_NOT_FOUND', path, `index ${index} out of range for replace`);
      }
      clone[index] = value;
    }
    return clone;
  }

  const key = String(head);
  if (mode === 'replace' && !Object.prototype.hasOwnProperty.call(clone, key)) {
    throw new PatchError('PATH_NOT_FOUND', path, `cannot replace missing key "${key}"`);
  }
  (clone as Record<string, unknown>)[key] = value;
  return clone;
}

function removeAt(node: unknown, tokens: readonly PathToken[], path: string): unknown {
  const head = tokens[0];
  if (head === undefined) return undefined;
  if (!isContainer(node)) {
    throw new PatchError('TYPE_MISMATCH', path, `cannot remove from ${typeof node}`);
  }
  const clone = shallowClone(node);
  const rest = tokens.slice(1);
  if (rest.length > 0) {
    const next = childOf(node, head, path);
    const updated = removeAt(next, rest, path);
    if (Array.isArray(clone)) clone[Number(head)] = updated;
    else (clone as Record<string, unknown>)[String(head)] = updated;
    return clone;
  }
  if (Array.isArray(clone)) {
    const index = typeof head === 'number' ? head : Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= clone.length) {
      throw new PatchError('PATH_NOT_FOUND', path, `index ${String(head)} out of range`);
    }
    clone.splice(index, 1);
    return clone;
  }
  const key = String(head);
  if (!Object.prototype.hasOwnProperty.call(clone, key)) {
    throw new PatchError('PATH_NOT_FOUND', path, `no such key "${key}"`);
  }
  delete (clone as Record<string, unknown>)[key];
  return clone;
}

/** Apply one operation, returning a new document. Never mutates the input. */
export function applyPatchOp<T>(document: T, op: JSONPatchOp): T {
  const tokens = parsePath(op.path);
  switch (op.op) {
    case 'add':
    case 'replace': {
      if (!('value' in op)) {
        throw new PatchError('MISSING_VALUE', op.path, `${op.op} requires a value`);
      }
      return writeAt(document, tokens, op.path, op.value, op.op) as T;
    }
    case 'remove':
      return removeAt(document, tokens, op.path) as T;
    default: {
      const never: never = op.op;
      throw new PatchError('INVALID_OP', op.path, `unknown op ${String(never)}`);
    }
  }
}

/** Apply a patch (a list of operations) in order, immutably. */
export function applyPatch<T>(document: T, ops: readonly JSONPatchOp[]): T {
  let next: T = document;
  for (const op of ops) next = applyPatchOp(next, op);
  return next;
}

/**
 * Compute the inverse of a patch against the document it is about to be applied
 * to. This is the whole basis of undo: we never store "before" snapshots, only
 * the operations needed to walk backwards.
 *
 * `add` on `/order/-` is normalised to a concrete index so the inverse
 * (`remove /order/<n>`) is exact.
 */
export function invertPatch(document: unknown, ops: readonly JSONPatchOp[]): JSONPatchOp[] {
  const inverse: JSONPatchOp[] = [];
  let cursor: unknown = document;

  for (const op of ops) {
    const tokens = parsePath(op.path);
    const exists = hasAtPath(cursor, op.path);

    if (op.op === 'add') {
      const parentPath = formatPath(tokens.slice(0, -1));
      const parent = getAtPath(cursor, parentPath);
      if (Array.isArray(parent)) {
        // Inserting into an array shifts everything after it, so the inverse is
        // always a removal at the same index — even when that index already held
        // a value before the insert.
        const index = tokens[tokens.length - 1] === '-' ? parent.length : Number(tokens[tokens.length - 1]);
        inverse.push({ op: 'remove', path: joinPath(parentPath, index) });
      } else {
        inverse.push(
          exists
            ? { op: 'replace', path: op.path, value: getAtPath(cursor, op.path) }
            : { op: 'remove', path: op.path },
        );
      }
    } else if (op.op === 'replace') {
      if (!exists) {
        throw new PatchError('PATH_NOT_FOUND', op.path, 'cannot invert replace of a missing path');
      }
      inverse.push({ op: 'replace', path: op.path, value: getAtPath(cursor, op.path) });
    } else {
      if (!exists) {
        throw new PatchError('PATH_NOT_FOUND', op.path, 'cannot invert remove of a missing path');
      }
      inverse.push({ op: 'add', path: op.path, value: getAtPath(cursor, op.path) });
    }

    cursor = applyPatchOp(cursor, op);
  }

  // Inverses must be applied back-to-front.
  return inverse.reverse();
}

/**
 * Assert that a value survives a JSON round-trip unchanged. Used by the
 * serializer so a bad payload fails loudly at the boundary instead of silently
 * disappearing into a file.
 */
export function assertJsonValue(value: unknown, path = '', seen = new Set<unknown>()): void {
  if (value === null) return;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') {
    if (kind === 'number' && !Number.isFinite(value as number)) {
      throw new PatchError('TYPE_MISMATCH', path, 'non-finite number is not valid JSON');
    }
    return;
  }
  if (kind !== 'object') {
    throw new PatchError('TYPE_MISMATCH', path, `${kind} is not valid JSON`);
  }
  if (seen.has(value)) {
    throw new PatchError('TYPE_MISMATCH', path, 'cyclic reference is not valid JSON');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, joinPath(path, index), seen));
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new PatchError('TYPE_MISMATCH', path, 'only plain objects are valid JSON');
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertJsonValue(item, joinPath(path, key), seen);
    }
  }
  seen.delete(value);
}
