import Konva from 'konva';
import { isObjectOfType, type Paint, type SceneObject, type Size, type TextData } from '@coslate/core';

/**
 * Scene object -> Konva node.
 *
 * This mapping is strictly one-way. The renderer reads the scene and writes
 * node attributes; it never writes back into the scene. When a gesture needs to
 * show intermediate feedback (a shape being dragged, a stroke being drawn) it
 * moves *nodes* and then commits exactly one command at the end.
 *
 * Every node's origin is the object's top-left corner, in the object's local
 * coordinate space, so `node.x/y/rotation/scaleX/scaleY` mirror the scene fields
 * one for one. That is why hit testing, the transformer and serialization all
 * agree without conversion code.
 */

const TEXT_LINE_HEIGHT = 1;

function applyPaint(node: Konva.Shape, fill: Paint, stroke: Paint, strokeWidth: number): void {
  if (fill === null) {
    node.fillEnabled(false);
  } else {
    node.fillEnabled(true);
    node.fill(fill);
  }
  if (stroke === null) {
    node.strokeEnabled(false);
  } else {
    node.strokeEnabled(true);
    node.stroke(stroke);
  }
  node.strokeWidth(strokeWidth);
  // Resizing an object must not turn a 2px outline into a 40px slab.
  node.strokeScaleEnabled(false);
  node.perfectDrawEnabled(false);
  node.shadowForStrokeEnabled(false);
}

function baseShapeConfig(object: SceneObject): Konva.ShapeConfig {
  return {
    id: object.id,
    name: object.type,
    x: object.x,
    y: object.y,
    rotation: object.rotation,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    visible: object.visible,
    // Selection, dragging and hovering are all handled by CoSlate's own
    // geometry, so the canvas hit graph is dead weight.
    listening: false,
    perfectDrawEnabled: false,
  };
}

function createRect(object: SceneObject): Konva.Shape {
  const node = new Konva.Rect({ ...baseShapeConfig(object), width: object.width, height: object.height });
  if (isObjectOfType(object, 'shape.rect')) {
    applyPaint(node, object.data.fill, object.data.stroke, object.data.strokeWidth);
    node.cornerRadius(object.data.cornerRadius);
  }
  return node;
}

/**
 * The ellipse is drawn with a custom `sceneFunc` rather than `Konva.Ellipse`.
 * `Konva.Ellipse` centres itself on its own origin, which would break the
 * "node origin == object top-left" invariant that the rest of the system relies
 * on. A dozen lines here buys one consistent transform model everywhere else.
 */
function createEllipse(object: SceneObject): Konva.Shape {
  const node = new Konva.Shape({
    ...baseShapeConfig(object),
    width: object.width,
    height: object.height,
    sceneFunc: (context, shape) => {
      const width = Math.abs(shape.width());
      const height = Math.abs(shape.height());
      context.beginPath();
      context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2, false);
      context.closePath();
      context.fillStrokeShape(shape);
    },
  });
  if (isObjectOfType(object, 'shape.ellipse')) {
    applyPaint(node, object.data.fill, object.data.stroke, object.data.strokeWidth);
  }
  return node;
}

function createLine(object: SceneObject): Konva.Shape {
  const node = new Konva.Line({
    ...baseShapeConfig(object),
    points: [],
    lineCap: 'round',
    lineJoin: 'round',
    tension: 0,
  });
  if (isObjectOfType(object, 'shape.line')) {
    node.points(object.data.points);
    applyPaint(node, null, object.data.stroke, object.data.strokeWidth);
  }
  return node;
}

function createArrow(object: SceneObject): Konva.Shape {
  const node = new Konva.Arrow({
    ...baseShapeConfig(object),
    points: [],
    lineCap: 'round',
    lineJoin: 'round',
    pointerAtBeginning: false,
    pointerAtEnding: true,
  });
  if (isObjectOfType(object, 'shape.arrow')) {
    node.points(object.data.points);
    node.pointerLength(object.data.pointerLength);
    node.pointerWidth(object.data.pointerWidth);
    applyPaint(node, null, object.data.stroke, object.data.strokeWidth);
    // The arrowhead is filled with the stroke colour.
    node.fill(object.data.stroke ?? '#000');
    node.fillEnabled(object.data.stroke !== null);
  }
  return node;
}

function createText(object: SceneObject): Konva.Shape {
  const node = new Konva.Text({
    ...baseShapeConfig(object),
    text: '',
    width: Math.max(1, object.width),
    height: Math.max(1, object.height),
    lineHeight: TEXT_LINE_HEIGHT,
    wrap: 'none',
    verticalAlign: 'top',
  });
  if (isObjectOfType(object, 'shape.text')) {
    const data = object.data;
    node.text(data.text);
    node.fontSize(data.fontSize);
    node.fontFamily(data.fontFamily);
    node.align(data.align);
    node.fill(data.fill ?? '#000');
    node.fillEnabled(data.fill !== null);
    node.strokeEnabled(false);
  }
  return node;
}

function createStroke(object: SceneObject): Konva.Shape {
  const node = new Konva.Line({
    ...baseShapeConfig(object),
    points: [],
    lineCap: 'round',
    lineJoin: 'round',
    tension: 0,
    bezier: false,
  });
  if (isObjectOfType(object, 'freehand.stroke')) {
    node.points(object.data.points);
    applyPaint(node, null, object.data.stroke, object.data.strokeWidth);
  }
  return node;
}

/** Create the node for an object. */
export function createObjectNode(object: SceneObject): Konva.Shape {
  switch (object.type) {
    case 'shape.rect':
      return createRect(object);
    case 'shape.ellipse':
      return createEllipse(object);
    case 'shape.line':
      return createLine(object);
    case 'shape.arrow':
      return createArrow(object);
    case 'shape.text':
      return createText(object);
    case 'freehand.stroke':
      return createStroke(object);
    default: {
      const never: never = object.type;
      throw new Error(`CoSlate: no renderer for object type ${String(never)}`);
    }
  }
}

/** Push every scene field of `object` onto an existing node. */
export function updateObjectNode(node: Konva.Shape, object: SceneObject): void {
  node.setAttrs({
    x: object.x,
    y: object.y,
    rotation: object.rotation,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    visible: object.visible,
    listening: false,
  });

  switch (object.type) {
    case 'shape.rect': {
      if (!isObjectOfType(object, 'shape.rect')) break;
      const rect = node as Konva.Rect;
      rect.width(object.width);
      rect.height(object.height);
      rect.cornerRadius(object.data.cornerRadius);
      applyPaint(rect, object.data.fill, object.data.stroke, object.data.strokeWidth);
      break;
    }
    case 'shape.ellipse': {
      if (!isObjectOfType(object, 'shape.ellipse')) break;
      node.width(object.width);
      node.height(object.height);
      applyPaint(node, object.data.fill, object.data.stroke, object.data.strokeWidth);
      break;
    }
    case 'shape.line': {
      if (!isObjectOfType(object, 'shape.line')) break;
      (node as Konva.Line).points(object.data.points);
      applyPaint(node, null, object.data.stroke, object.data.strokeWidth);
      break;
    }
    case 'shape.arrow': {
      if (!isObjectOfType(object, 'shape.arrow')) break;
      const arrow = node as Konva.Arrow;
      arrow.points(object.data.points);
      arrow.pointerLength(object.data.pointerLength);
      arrow.pointerWidth(object.data.pointerWidth);
      applyPaint(arrow, null, object.data.stroke, object.data.strokeWidth);
      arrow.fill(object.data.stroke ?? '#000');
      arrow.fillEnabled(object.data.stroke !== null);
      break;
    }
    case 'shape.text': {
      if (!isObjectOfType(object, 'shape.text')) break;
      const text = node as Konva.Text;
      text.text(object.data.text);
      text.fontSize(object.data.fontSize);
      text.fontFamily(object.data.fontFamily);
      text.align(object.data.align);
      text.fill(object.data.fill ?? '#000');
      text.fillEnabled(object.data.fill !== null);
      text.width(Math.max(1, object.width));
      text.height(Math.max(1, object.height));
      break;
    }
    case 'freehand.stroke': {
      if (!isObjectOfType(object, 'freehand.stroke')) break;
      (node as Konva.Line).points(object.data.points);
      applyPaint(node, null, object.data.stroke, object.data.strokeWidth);
      break;
    }
    default:
      break;
  }
}

/** Konva text attributes for a text payload, shared by the node and the overlay editor. */
export function textAttrs(data: TextData): Record<string, string | number> {
  return {
    fontFamily: data.fontFamily,
    fontSize: data.fontSize,
    lineHeight: TEXT_LINE_HEIGHT,
    align: data.align,
  };
}

const measureCache = new Map<string, Size>();

/**
 * Measure a text payload without touching the document. Uses a detached Konva
 * node so the measurement is exactly what the renderer will draw.
 */
export function measureText(data: TextData): Size {
  const key = `${data.fontFamily}|${data.fontSize}|${data.text}`;
  const cached = measureCache.get(key);
  if (cached) return cached;

  const node = new Konva.Text({ ...textAttrs(data), text: data.text, wrap: 'none' });
  const size: Size = {
    width: Math.max(data.fontSize * 0.4, Math.ceil(node.width())),
    height: Math.max(data.fontSize, Math.ceil(node.height())),
  };
  if (measureCache.size > 512) measureCache.clear();
  measureCache.set(key, size);
  node.destroy();
  return size;
}
