import { assertJsonValue } from './jsonpatch.js';
import { OBJECT_TYPES, SCENE_FORMAT, SCENE_VERSION, type Id, type ObjectType, type Scene, type SceneObject } from './types.js';

/**
 * Serialization contract.
 *
 * A serialized scene is a JSON document with an explicit `format` tag and an
 * integer `version`. The rules:
 *
 *  1. Reading a document with a version *older* than this build runs it through
 *     the migration chain (see {@link registerMigration}).
 *  2. Reading a document with a version *newer* than this build fails with a
 *     typed error. It must never be silently coerced, because doing so would
 *     drop fields the newer writer cared about and corrupt the user's file.
 *  3. Reading a document with an unknown `format` fails the same way.
 *
 * Failing loudly is a feature: a whiteboard that eats your drawing is worse than
 * one that refuses to open it.
 */

export type SerializeErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_DOCUMENT'
  | 'UNKNOWN_FORMAT'
  | 'FUTURE_VERSION'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_SCENE';

export class SceneSerializationError extends Error {
  public readonly code: SerializeErrorCode;
  public readonly detail: string;

  constructor(code: SerializeErrorCode, detail: string) {
    super(`CoSlate serialization error (${code}): ${detail}`);
    this.name = 'SceneSerializationError';
    this.code = code;
    this.detail = detail;
  }
}

/** A raw, not-yet-validated document. */
export type RawDocument = Record<string, unknown>;

export type Migration = (document: RawDocument) => RawDocument;

const migrations = new Map<number, Migration>();

/**
 * Register a migration from `fromVersion` to `fromVersion + 1`.
 * Migrations must be pure and must not mutate their input.
 */
export function registerMigration(fromVersion: number, migration: Migration): void {
  migrations.set(fromVersion, migration);
}

/**
 * Walk a raw document forward to `target` (default {@link SCENE_VERSION}).
 * Throws {@link SceneSerializationError} for future or unmigratable versions.
 *
 * `target` is exposed mainly so the migration chain is testable today, while
 * `SCENE_VERSION` is still 1 and no real migration exists yet.
 */
export function migrate(raw: unknown, target: number = SCENE_VERSION): RawDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SceneSerializationError('INVALID_DOCUMENT', 'scene must be a JSON object');
  }
  let document = raw as RawDocument;

  if (document.format !== SCENE_FORMAT) {
    throw new SceneSerializationError(
      'UNKNOWN_FORMAT',
      `expected format "${SCENE_FORMAT}", received ${JSON.stringify(document.format ?? null)}`,
    );
  }

  const version = document.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SceneSerializationError('INVALID_DOCUMENT', `"version" must be a positive integer, got ${String(version)}`);
  }
  if (version > target) {
    throw new SceneSerializationError(
      'FUTURE_VERSION',
      `document version ${version} is newer than this build (${target}); ` +
        'upgrade CoSlate instead of opening it with an older reader',
    );
  }

  let current = version;
  while (current < target) {
    const migration = migrations.get(current);
    if (!migration) {
      throw new SceneSerializationError(
        'UNSUPPORTED_VERSION',
        `no migration registered from version ${current} to ${current + 1}`,
      );
    }
    document = migration(document);
    current += 1;
    document = { ...document, version: current };
  }

  return document;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(source: Record<string, unknown>, key: string, where: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SceneSerializationError('INVALID_SCENE', `${where}.${key} must be a finite number`);
  }
  return value;
}

function isObjectType(value: unknown): value is ObjectType {
  return typeof value === 'string' && (OBJECT_TYPES as readonly string[]).includes(value);
}

/**
 * Validate an untrusted document into a {@link Scene}.
 *
 * Validation is strict about structure (ids, order, geometry) and permissive
 * about payloads (`data`, `meta` are open bags by design — that is the extension
 * hatch that keeps future features from needing a format bump).
 */
export function validateScene(raw: unknown): Scene {
  if (!isRecord(raw)) {
    throw new SceneSerializationError('INVALID_SCENE', 'scene must be an object');
  }
  const viewportRaw = raw.viewport;
  if (!isRecord(viewportRaw)) {
    throw new SceneSerializationError('INVALID_SCENE', 'scene.viewport must be an object');
  }
  const scale = requireNumber(viewportRaw, 'scale', 'scene.viewport');
  if (scale <= 0) {
    throw new SceneSerializationError('INVALID_SCENE', 'scene.viewport.scale must be > 0');
  }
  const viewport = {
    x: requireNumber(viewportRaw, 'x', 'scene.viewport'),
    y: requireNumber(viewportRaw, 'y', 'scene.viewport'),
    scale,
  };

  const objectsRaw = raw.objects;
  if (!isRecord(objectsRaw)) {
    throw new SceneSerializationError('INVALID_SCENE', 'scene.objects must be an object map');
  }
  const orderRaw = raw.order;
  if (!Array.isArray(orderRaw)) {
    throw new SceneSerializationError('INVALID_SCENE', 'scene.order must be an array of ids');
  }

  const objects: Record<Id, SceneObject> = {};
  for (const [id, value] of Object.entries(objectsRaw)) {
    if (!isRecord(value)) {
      throw new SceneSerializationError('INVALID_SCENE', `scene.objects["${id}"] must be an object`);
    }
    if (value.id !== id) {
      throw new SceneSerializationError('INVALID_SCENE', `scene.objects["${id}"].id must equal its key`);
    }
    if (!isObjectType(value.type)) {
      throw new SceneSerializationError('INVALID_SCENE', `scene.objects["${id}"].type is not a known object type`);
    }
    if (!isRecord(value.data)) {
      throw new SceneSerializationError('INVALID_SCENE', `scene.objects["${id}"].data must be an object`);
    }
    const object: SceneObject = {
      id,
      type: value.type,
      version: requireNumber(value, 'version', `scene.objects["${id}"]`),
      x: requireNumber(value, 'x', `scene.objects["${id}"]`),
      y: requireNumber(value, 'y', `scene.objects["${id}"]`),
      width: requireNumber(value, 'width', `scene.objects["${id}"]`),
      height: requireNumber(value, 'height', `scene.objects["${id}"]`),
      rotation: requireNumber(value, 'rotation', `scene.objects["${id}"]`),
      scaleX: requireNumber(value, 'scaleX', `scene.objects["${id}"]`),
      scaleY: requireNumber(value, 'scaleY', `scene.objects["${id}"]`),
      z: requireNumber(value, 'z', `scene.objects["${id}"]`),
      visible: value.visible !== false,
      locked: value.locked === true,
      data: value.data as unknown as SceneObject['data'],
    };
    if ('parentId' in value) object.parentId = (value.parentId as Id | null) ?? null;
    if (isRecord(value.meta)) object.meta = value.meta;
    objects[id] = object;
  }

  const seen = new Set<string>();
  const order: Id[] = [];
  for (const entry of orderRaw) {
    if (typeof entry !== 'string') {
      throw new SceneSerializationError('INVALID_SCENE', 'scene.order must contain only string ids');
    }
    if (seen.has(entry)) {
      throw new SceneSerializationError('INVALID_SCENE', `scene.order lists "${entry}" more than once`);
    }
    if (!(entry in objects)) {
      throw new SceneSerializationError('INVALID_SCENE', `scene.order references unknown object "${entry}"`);
    }
    seen.add(entry);
    order.push(entry);
  }
  const missing = Object.keys(objects).filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new SceneSerializationError('INVALID_SCENE', `scene.order is missing object ids: ${missing.join(', ')}`);
  }

  const scene: Scene = {
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    viewport,
    objects,
    order,
  };
  if (isRecord(raw.meta)) scene.meta = raw.meta;
  return scene;
}

export interface SerializeOptions {
  /** Pretty-print with two-space indentation. Defaults to `false`. */
  pretty?: boolean;
}

/** Render a scene to JSON text. Validates first, so a corrupt scene cannot be written. */
export function serialize(scene: Scene, options: SerializeOptions = {}): string {
  const validated = validateScene(scene);
  assertJsonValue(validated);
  return options.pretty ? JSON.stringify(validated, null, 2) : JSON.stringify(validated);
}

/**
 * Parse and validate JSON text (or an already-parsed value) into a scene.
 *
 * @throws {SceneSerializationError} on malformed JSON, unknown format, or a
 * document written by a newer version of CoSlate.
 */
export function deserialize(input: string | unknown): Scene {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      throw new SceneSerializationError(
        'INVALID_JSON',
        error instanceof Error ? error.message : 'could not parse JSON',
      );
    }
  }
  const migrated = migrate(parsed);
  return validateScene(migrated);
}

/** Round-trip helper used by exporters and tests. */
export function cloneScene(scene: Scene): Scene {
  return deserialize(serialize(scene));
}
