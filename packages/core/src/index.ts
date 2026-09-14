/**
 * @coslate/core — the scene runtime.
 *
 * There are no runtime dependencies, no DOM access and no renderer here. This
 * package is the part you can run on a server, in a worker, in a test, or inside
 * somebody else's editor.
 */

export type {
  Bounds,
  EllipseData,
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
  TextData,
  Viewport,
} from './types.js';

export {
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
  zoomAt,
  zoomTo,
} from './viewport.js';

export type { Migration, RawDocument, SerializeErrorCode, SerializeOptions } from './serialize.js';
export {
  cloneScene,
  deserialize,
  migrate,
  registerMigration,
  SceneSerializationError,
  serialize,
  validateScene,
} from './serialize.js';

export type { CreateObjectInput, ObjectPropPatch, ReorderTarget } from './patches.js';
export {
  addObjectOps,
  makeObject,
  objectPath,
  removeObjectOps,
  reorderObjectOps,
  sceneFromObjects,
  setViewportOps,
  updateObjectDataOps,
  updateObjectOps,
} from './patches.js';
