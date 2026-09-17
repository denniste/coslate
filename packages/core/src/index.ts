/**
 * @coslate/core — the scene runtime.
 *
 * There are no runtime dependencies, no DOM access and no renderer here. This
 * package is the part you can run on a server, in a worker, in a test, or inside
 * somebody else's editor.
 */

export type { BoardThemeName, BoardThemePreset, GridAppearance } from './appearance.js';
export { BOARD_THEMES, DEFAULT_BACKGROUND, DEFAULT_GRID, resolveGrid } from './appearance.js';

export type {
  Bounds,
  EllipseData,
  EndpointBinding,
  Id,
  LineData,
  ObjectData,
  ObjectDataMap,
  ObjectType,
  Paint,
  Point,
  RectData,
  ArrowData,
  Scene,
  SceneObject,
  SceneObjectOf,
  Size,
  StrokeData,
  StrokeStyle,
  TextData,
  Viewport,
} from './types.js';

export {
  dashPattern,
  defaultData,
  isObjectOfType,
  OBJECT_TYPES,
  SCENE_FORMAT,
  SCENE_VERSION,
} from './types.js';

export { newId } from './ids.js';

export type { JSONPatchOp, JSONValue, PatchErrorCode, PathToken } from './jsonpatch.js';
export {
  applyPatch,
  applyPatchOp,
  assertJsonValue,
  formatPath,
  getAtPath,
  hasAtPath,
  invertPatch,
  joinPath,
  parsePath,
  PatchError,
} from './jsonpatch.js';

export type { Command, CommandSource, CreateCommandInput } from './command.js';
export { applyCommands, createCommand, isCommand, revertCommands } from './command.js';

export type { HistoryEntry, HistoryOptions } from './history.js';
export { DEFAULT_HISTORY_LIMIT, History, redoEntry, undoEntry } from './history.js';

export type {
  ChangeEvent,
  ChangeOrigin,
  CommitInput,
  SceneHandle,
  SceneStore,
  StoreListener,
  StoreOptions,
  TransactionContext,
  TransactionOptions,
} from './store.js';
export { createEmptyScene, createSceneStore, createStore } from './store.js';

export type { ScaleLimits } from './viewport.js';
export {
  boundsCenter,
  boundsContain,
  boundsIntersect,
  boundsOfPoints,
  clampScale,
  DEFAULT_VIEWPORT,
  expandBounds,
  fitToContent,
  MAX_SCALE,
  MIN_SCALE,
  objectBounds,
  panBy,
  panByWorld,
  screenRectToWorldBounds,
  screenToWorld,
  unionBounds,
  worldToScreen,
  wheelZoomFactor,
  zoomAt,
  zoomTo,
} from './viewport.js';

export type {
  BaselineReadResult,
  Migration,
  RawDocument,
  SerializeErrorCode,
  SerializeOptions,
} from './serialize.js';
export {
  cloneScene,
  deserialize,
  isSceneEmpty,
  migrate,
  readBaseline,
  registerMigration,
  SceneSerializationError,
  serialize,
  validateScene,
} from './serialize.js';

export type { DeltaOptions, SceneDelta } from './records.js';
export {
  applyDelta,
  deltaToCommands,
  deltaToInverseCommands,
  deltaToOps,
  diffScenes,
  isEmptyDelta,
  normalizeDelta,
  recordsFromCommands,
  shouldBroadcast,
} from './records.js';

export type { CreateObjectInput, ObjectPropPatch, ReorderTarget } from './patches.js';
export {
  addObjectOps,
  makeObject,
  objectPath,
  removeObjectOps,
  reorderObjectOps,
  sceneFromObjects,
  updateObjectDataOps,
  updateObjectOps,
} from './patches.js';

export type {
  Catalog,
  Direction,
  I18n,
  I18nOptions,
  Message,
  MessageParams,
  PluralForms,
} from './i18n.js';
export {
  canonicalLocale,
  createI18n,
  DEFAULT_LOCALE,
  localeDirection,
  lookupLocale,
} from './i18n.js';
