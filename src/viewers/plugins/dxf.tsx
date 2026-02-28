import { useEffect, useMemo, useRef, useState } from "react";
import DxfParser from "dxf-parser";
import type { ViewerPlugin } from "../types";

type Point = { x: number; y: number; };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number; };
type HatchPatternLine = {
  angle: number;
  spacing: number;
  originX: number;
  originY: number;
  dash: number[];
  dashOffset: number;
};
type HatchPattern = {
  lines: HatchPatternLine[];
};

type Primitive =
  | { kind: "line"; layer: string; start: Point; end: Point; }
  | { kind: "polyline"; layer: string; points: Point[]; closed: boolean; }
  | { kind: "hatch"; layer: string; loops: Point[][]; solid: boolean; pattern: HatchPattern; }
  | { kind: "circle"; layer: string; center: Point; radius: number; }
  | {
    kind: "arc";
    layer: string;
    center: Point;
    radius: number;
    startAngle: number;
    endAngle: number;
  }
  | {
    kind: "ellipse";
    layer: string;
    center: Point;
    majorAxisEndPoint: Point;
    axisRatio: number;
    startAngle: number;
    endAngle: number;
  }
  | { kind: "spline"; layer: string; points: Point[]; }
  | {
    kind: "text";
    layer: string;
    text: string;
    position: Point;
    height: number;
    rotation: number;
    multiline: boolean;
  };

type LayerSummary = { name: string; count: number; };

interface ParsedDxf {
  primitives: Primitive[];
  bounds: Bounds;
  layers: LayerSummary[];
}

function isHatchPrimitive(
  primitive: Primitive
): primitive is Extract<Primitive, { kind: "hatch"; }> {
  return primitive.kind === "hatch";
}

function toRadians(angle: number): number {
  if (Math.abs(angle) > Math.PI * 2) {
    return (angle * Math.PI) / 180;
  }
  return angle;
}

function getLayerName(raw: unknown): string {
  const layer = String(raw ?? "").trim();
  return layer.length > 0 ? layer : "0";
}

function emptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function ensureFiniteBounds(bounds: Bounds): Bounds {
  if (!Number.isFinite(bounds.minX)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return bounds;
}

function updateBounds(bounds: Bounds, p: Point) {
  bounds.minX = Math.min(bounds.minX, p.x);
  bounds.minY = Math.min(bounds.minY, p.y);
  bounds.maxX = Math.max(bounds.maxX, p.x);
  bounds.maxY = Math.max(bounds.maxY, p.y);
}

function extendBoundsForPrimitive(bounds: Bounds, primitive: Primitive) {
  if (primitive.kind === "line") {
    updateBounds(bounds, primitive.start);
    updateBounds(bounds, primitive.end);
    return;
  }

  if (primitive.kind === "polyline") {
    for (const point of primitive.points) {
      updateBounds(bounds, point);
    }
    return;
  }

  if (primitive.kind === "hatch") {
    for (const loop of primitive.loops) {
      for (const point of loop) {
        updateBounds(bounds, point);
      }
    }
    return;
  }

  if (primitive.kind === "text") {
    const lines = primitive.text.split("\n");
    const maxLine = lines.reduce((acc, line) => Math.max(acc, line.length), 0);
    const textW = Math.max(maxLine * primitive.height * 0.6, primitive.height);
    const textH = Math.max(lines.length * primitive.height * 1.2, primitive.height);

    const corners = [
      { x: 0, y: 0 },
      { x: textW, y: 0 },
      { x: textW, y: textH },
      { x: 0, y: textH }
    ];
    const cos = Math.cos(primitive.rotation);
    const sin = Math.sin(primitive.rotation);

    for (const corner of corners) {
      const x = primitive.position.x + corner.x * cos - corner.y * sin;
      const y = primitive.position.y + corner.x * sin + corner.y * cos;
      updateBounds(bounds, { x, y });
    }
    return;
  }

  if (primitive.kind === "spline") {
    for (const point of primitive.points) {
      updateBounds(bounds, point);
    }
    return;
  }

  if (primitive.kind === "ellipse") {
    const points = ellipseToPoints(
      primitive.center,
      primitive.majorAxisEndPoint,
      primitive.axisRatio,
      primitive.startAngle,
      primitive.endAngle,
      72
    );
    for (const point of points) {
      updateBounds(bounds, point);
    }
    return;
  }

  updateBounds(bounds, {
    x: primitive.center.x - primitive.radius,
    y: primitive.center.y - primitive.radius
  });
  updateBounds(bounds, {
    x: primitive.center.x + primitive.radius,
    y: primitive.center.y + primitive.radius
  });
}

function computeBounds(primitives: Primitive[]): Bounds | null {
  if (primitives.length === 0) return null;
  const bounds = emptyBounds();
  for (const primitive of primitives) {
    extendBoundsForPrimitive(bounds, primitive);
  }
  return ensureFiniteBounds(bounds);
}

function layerColor(layer: string): string {
  let hash = 0;
  for (let i = 0; i < layer.length; i += 1) {
    hash = (hash * 31 + layer.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 72% 64%)`;
}

function pickPoint(entity: Record<string, unknown>): Point | null {
  const candidates = [
    entity.start,
    entity.startPoint,
    entity.insertionPoint,
    entity.position,
    entity.point,
    entity.alignPoint,
    entity.textMidpoint,
    entity.textMidPoint,
    entity.middleOfText
  ];
  for (const raw of candidates) {
    if (!raw || typeof raw !== "object") continue;
    const point = raw as { x?: unknown; y?: unknown; };
    if (typeof point.x === "number" && typeof point.y === "number") {
      return { x: point.x, y: point.y };
    }
  }
  return null;
}

function normalizeMText(raw: string): string {
  return raw
    .replace(/\\P/gi, "\n")
    .replace(/\\X/gi, "\n")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

function normalizeEllipseAngles(
  startAngle: number,
  endAngle: number
): { start: number; end: number; } {
  let start = startAngle;
  let end = endAngle;
  if (end <= start) {
    end += Math.PI * 2;
  }
  return { start, end };
}

function ellipseToPoints(
  center: Point,
  majorAxisEndPoint: Point,
  axisRatio: number,
  startAngle: number,
  endAngle: number,
  segments: number
): Point[] {
  const majorLen = Math.hypot(majorAxisEndPoint.x, majorAxisEndPoint.y);
  if (majorLen <= 0 || axisRatio <= 0) return [];

  const ux = majorAxisEndPoint.x / majorLen;
  const uy = majorAxisEndPoint.y / majorLen;
  const vx = -uy;
  const vy = ux;

  const minorLen = majorLen * axisRatio;
  const { start, end } = normalizeEllipseAngles(startAngle, endAngle);
  const count = Math.max(segments, 12);
  const points: Point[] = [];

  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const angle = start + (end - start) * t;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    points.push({
      x: center.x + ux * majorLen * cos + vx * minorLen * sin,
      y: center.y + uy * majorLen * cos + vy * minorLen * sin
    });
  }

  return points;
}

function normalizeArcAngles(
  start: number,
  end: number,
  ccw: boolean
): { start: number; end: number; } {
  let s = start;
  let e = end;
  const full = Math.PI * 2;
  if (ccw) {
    while (e <= s) e += full;
  } else {
    while (e >= s) e -= full;
  }
  return { start: s, end: e };
}

function arcPoints(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  ccw: boolean,
  segments: number
): Point[] {
  if (radius <= 0 || segments < 1) return [];
  const { start, end } = normalizeArcAngles(startAngle, endAngle, ccw);
  const points: Point[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const angle = start + (end - start) * t;
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }
  return points;
}

function appendSegmentPoints(target: Point[], segment: Point[]) {
  if (segment.length === 0) return;
  if (target.length === 0) {
    target.push(...segment);
    return;
  }
  target.push(...segment.slice(1));
}

function bulgeToSegmentPoints(start: Point, end: Point, bulge: number): Point[] {
  if (Math.abs(bulge) < 1e-9) {
    return [start, end];
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= 1e-9) {
    return [start];
  }

  const theta = 4 * Math.atan(bulge);
  const absTheta = Math.abs(theta);
  if (absTheta <= 1e-6) {
    return [start, end];
  }

  const radius = chord / (2 * Math.sin(absTheta / 2));
  if (!Number.isFinite(radius) || Math.abs(radius) <= 1e-9) {
    return [start, end];
  }

  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const ux = dx / chord;
  const uy = dy / chord;
  const px = -uy;
  const py = ux;
  const h = Math.sqrt(Math.max(radius * radius - (chord * chord) / 4, 0));
  const side = bulge > 0 ? 1 : -1;
  const center = { x: mx + px * h * side, y: my + py * h * side };

  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const segments = Math.max(6, Math.ceil(absTheta / (Math.PI / 18)));
  return arcPoints(center, Math.abs(radius), startAngle, endAngle, bulge > 0, segments);
}

function expandPolylineVertices(rawVertices: Point[] | undefined, closed: boolean): Point[] {
  const vertices = rawVertices ?? [];
  if (vertices.length < 2) return [];

  const points: Point[] = [];
  const last = closed ? vertices.length : vertices.length - 1;

  for (let i = 0; i < last; i += 1) {
    const current = vertices[i] as Point & { bulge?: unknown; };
    const next = vertices[(i + 1) % vertices.length];
    const bulge = Number(current.bulge ?? 0);
    const segment = bulgeToSegmentPoints(
      { x: current.x, y: current.y },
      { x: next.x, y: next.y },
      bulge
    );
    appendSegmentPoints(points, segment);
  }

  if (!closed && points.length > 0) {
    const final = vertices[vertices.length - 1];
    const tail = points[points.length - 1];
    if (Math.hypot(tail.x - final.x, tail.y - final.y) > 1e-6) {
      points.push({ x: final.x, y: final.y });
    }
  }

  return points;
}

function transformPoints(points: Point[], matrix: Matrix2D): Point[] {
  if (isIdentityMatrix(matrix)) return points.map((p) => ({ x: p.x, y: p.y }));
  return points.map((point) => applyPoint(matrix, point));
}

function extractHatchLoops(entity: Record<string, unknown>, matrix: Matrix2D): Point[][] {
  const loopsRaw = Array.isArray(entity.boundaryLoops)
    ? (entity.boundaryLoops as Record<string, unknown>[])
    : [];

  const loops: Point[][] = [];

  for (const loop of loopsRaw) {
    const loopPoints: Point[] = [];
    const loopVertices = Array.isArray(loop.vertices) ? (loop.vertices as Point[]) : [];
    if (loopVertices.length >= 2) {
      loops.push(transformPoints(expandPolylineVertices(loopVertices, true), matrix));
      continue;
    }

    const polyline = loop.polyline as Record<string, unknown> | undefined;
    const polylineVertices = Array.isArray(polyline?.vertices)
      ? (polyline.vertices as Point[])
      : [];
    if (polylineVertices.length >= 2) {
      loops.push(transformPoints(expandPolylineVertices(polylineVertices, true), matrix));
      continue;
    }

    const edges = Array.isArray(loop.edges) ? (loop.edges as Record<string, unknown>[]) : [];
    for (const edge of edges) {
      const edgeType = String(edge.type ?? "").toUpperCase();

      if (edgeType === "LINE") {
        const start = edge.start as Point | undefined;
        const end = edge.end as Point | undefined;
        if (!start || !end) continue;
        appendSegmentPoints(loopPoints, [applyPoint(matrix, start), applyPoint(matrix, end)]);
        continue;
      }

      if (edgeType === "ARC") {
        const center = edge.center as Point | undefined;
        const radius = Number(edge.radius ?? 0);
        const startAngle = toRadians(Number(edge.startAngle ?? 0));
        const endAngle = toRadians(Number(edge.endAngle ?? 0));
        const ccw = Boolean(edge.counterClockwise ?? edge.isCounterClockwise ?? true);
        if (!center || radius <= 0) continue;
        const segment = arcPoints(center, radius, startAngle, endAngle, ccw, 36);
        appendSegmentPoints(loopPoints, transformPoints(segment, matrix));
        continue;
      }

      if (edgeType === "ELLIPSE") {
        const center = edge.center as Point | undefined;
        const majorAxisEndPoint = edge.majorAxisEndPoint as Point | undefined;
        const axisRatio = Number(edge.axisRatio ?? 1);
        const startAngle = toRadians(Number(edge.startAngle ?? 0));
        const endAngle = toRadians(Number(edge.endAngle ?? Math.PI * 2));
        if (!center || !majorAxisEndPoint || axisRatio <= 0) continue;
        const segment = ellipseToPoints(
          center,
          majorAxisEndPoint,
          axisRatio,
          startAngle,
          endAngle,
          48
        );
        appendSegmentPoints(loopPoints, transformPoints(segment, matrix));
        continue;
      }

      if (edgeType === "SPLINE") {
        const fitPoints = Array.isArray(edge.fitPoints) ? (edge.fitPoints as Point[]) : [];
        const controlPoints = Array.isArray(edge.controlPoints)
          ? (edge.controlPoints as Point[])
          : [];
        const src = fitPoints.length >= 2 ? fitPoints : controlPoints;
        if (src.length < 2) continue;
        appendSegmentPoints(
          loopPoints,
          transformPoints(src.map((p) => ({ x: p.x, y: p.y })), matrix)
        );
      }
    }

    if (loopPoints.length >= 3) {
      loops.push(loopPoints);
    }
  }

  return loops.filter((loop) => loop.length >= 3);
}

function extractHatchPattern(
  entity: Record<string, unknown>
): { solid: boolean; pattern: HatchPattern; } {
  const patternName = String(entity.patternName ?? entity.name ?? "").trim().toUpperCase();
  const solidByFlag = Boolean(entity.solidFill ?? entity.isSolid);
  const solidByPattern = patternName.length === 0 || patternName === "SOLID";

  const definitionLines = Array.isArray(entity.patternDefinitionLines)
    ? (entity.patternDefinitionLines as Record<string, unknown>[])
    : [];
  const solid = definitionLines.length === 0 && (solidByFlag || solidByPattern);
  const toDash = (def: Record<string, unknown>): number[] => {
    const rawDash = (Array.isArray(def.dashArray) && def.dashArray)
      || (Array.isArray(def.dashPattern) && def.dashPattern)
      || (Array.isArray(def.linePattern) && def.linePattern)
      || (Array.isArray(def.dashes) && def.dashes)
      || (typeof def.dashArray === "string" ? def.dashArray.split(/[,\s]+/) : null)
      || null;

    const source = Array.isArray(rawDash) ? rawDash : [];
    const dash = source
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => {
        if (Math.abs(value) < 1e-9) return 1.5;
        return Math.max(Math.abs(value) * 8, 1.5);
      });
    return dash.length >= 2 ? dash : [];
  };

  const lines = definitionLines
    .map((def) => {
      const angle = toRadians(Number(def.angle ?? entity.patternAngle ?? entity.angle ?? 45));
      const dirX = Math.cos(angle);
      const dirY = -Math.sin(angle);
      const nX = -dirY;
      const nY = dirX;
      const dx = Number(def.deltaX ?? def.offsetX ?? 0);
      const dy = Number(def.deltaY ?? def.offsetY ?? 0);
      const spacingFromDelta = Math.abs(dx * nX + dy * nY);
      const spacingFromField = Number(def.spacing ?? entity.patternScale ?? entity.scale ?? 1);
      const spacing = Math.max(Math.abs(spacingFromDelta || spacingFromField) * 8, 4);

      const originX = Number(def.x ?? def.originX ?? def.baseX ?? 0) * 8;
      const originY = Number(def.y ?? def.originY ?? def.baseY ?? 0) * 8;
      const dashOffset = Number(def.dashOffset ?? def.offsetX ?? 0) * 8;

      return {
        angle,
        spacing,
        originX: Number.isFinite(originX) ? originX : 0,
        originY: Number.isFinite(originY) ? originY : 0,
        dash: toDash(def),
        dashOffset: Number.isFinite(dashOffset) ? dashOffset : 0
      } satisfies HatchPatternLine;
    })
    .filter((line) => Number.isFinite(line.spacing) && line.spacing > 0);

  if (lines.length === 0) {
    const angle = toRadians(Number(entity.patternAngle ?? entity.angle ?? 45));
    const spacing = Math.max(Math.abs(Number(entity.patternScale ?? entity.scale ?? 1)) * 8, 4);
    lines.push({
      angle,
      spacing,
      originX: 0,
      originY: 0,
      dash: [],
      dashOffset: 0
    });
    if (patternName.includes("CROSS") || patternName === "ANSI31") {
      lines.push({
        angle: angle + Math.PI / 2,
        spacing,
        originX: 0,
        originY: 0,
        dash: [],
        dashOffset: 0
      });
    }
  }

  return { solid, pattern: { lines } };
}

function strokeHatchPattern(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pattern: HatchPattern
) {
  const diag = Math.hypot(width, height);
  const cx = width / 2;
  const cy = height / 2;

  const drawSet = (line: HatchPatternLine) => {
    const angle = line.angle;
    const dirX = Math.cos(angle);
    const dirY = -Math.sin(angle);
    const nX = -dirY;
    const nY = dirX;
    const baseNormal = nX * line.originX + nY * line.originY;
    const baseAlong = dirX * line.originX + dirY * line.originY;

    for (let offset = -diag; offset <= diag; offset += line.spacing) {
      const shifted = offset + baseNormal;
      const sx = cx + nX * shifted + dirX * (baseAlong - diag);
      const sy = cy + nY * shifted + dirY * (baseAlong - diag);
      const ex = cx + nX * shifted + dirX * (baseAlong + diag);
      const ey = cy + nY * shifted + dirY * (baseAlong + diag);
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
    }
  };

  const drawPatternLine = (line: HatchPatternLine) => {
    ctx.setLineDash(line.dash);
    const dirX = Math.cos(line.angle);
    const dirY = -Math.sin(line.angle);
    const originAlong = dirX * line.originX + dirY * line.originY;
    ctx.lineDashOffset = line.dashOffset + originAlong;
    ctx.beginPath();
    drawSet(line);
    ctx.stroke();
  };

  for (const line of pattern.lines) {
    drawPatternLine(line);
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

type Matrix2D = { a: number; b: number; c: number; d: number; e: number; f: number; };

function identityMatrix(): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function translationMatrix(x: number, y: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function rotationMatrix(angle: number): Matrix2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

function scaleMatrix(x: number, y: number): Matrix2D {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function multiplyMatrix(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  };
}

function applyPoint(matrix: Matrix2D, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

function applyVector(matrix: Matrix2D, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y,
    y: matrix.b * point.x + matrix.d * point.y
  };
}

function isIdentityMatrix(matrix: Matrix2D): boolean {
  const eps = 1e-9;
  return Math.abs(matrix.a - 1) < eps
    && Math.abs(matrix.d - 1) < eps
    && Math.abs(matrix.b) < eps
    && Math.abs(matrix.c) < eps
    && Math.abs(matrix.e) < eps
    && Math.abs(matrix.f) < eps;
}

function parseDxf(content: string): ParsedDxf {
  const parser = new DxfParser();
  const result = parser.parseSync(content) as
    | {
      entities?: unknown[];
      blocks?: Record<string, { entities?: unknown[]; }>;
    }
    | null
    | undefined;
  if (!result || typeof result !== "object") {
    throw new Error("DXF parser returned no document. Binary DXF may not be supported.");
  }

  const entities = Array.isArray(result.entities) ? result.entities : [];
  const blocks = result.blocks && typeof result.blocks === "object" ? result.blocks : {};

  const primitives: Primitive[] = [];
  const layerCounts = new Map<string, number>();

  const pushPrimitive = (primitive: Primitive) => {
    primitives.push(primitive);
    layerCounts.set(primitive.layer, (layerCounts.get(primitive.layer) ?? 0) + 1);
  };

  const expandEntity = (
    entity: Record<string, unknown>,
    matrix: Matrix2D,
    blockStack: string[],
    depth: number
  ) => {
    if (depth > 10) return;

    const type = String(entity.type ?? "");
    const layer = getLayerName(entity.layer);
    const matrixIsIdentity = isIdentityMatrix(matrix);

    if (type === "LINE") {
      const start = entity.start as Point | undefined;
      const end = entity.end as Point | undefined;
      if (!start || !end) return;
      pushPrimitive({
        kind: "line",
        layer,
        start: applyPoint(matrix, start),
        end: applyPoint(matrix, end)
      });
      return;
    }

    if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const rawVertices = (entity.vertices as Point[] | undefined) ?? [];
      if (rawVertices.length < 2) return;
      const points = transformPoints(
        expandPolylineVertices(rawVertices, Boolean(entity.shape ?? entity.closed)),
        matrix
      );
      if (points.length < 2) return;
      const closed = Boolean(entity.shape ?? entity.closed);
      pushPrimitive({ kind: "polyline", layer, points, closed });
      return;
    }

    if (type === "HATCH") {
      const loops = extractHatchLoops(entity, matrix);
      if (loops.length === 0) return;
      const { solid, pattern } = extractHatchPattern(entity);
      pushPrimitive({ kind: "hatch", layer, loops, solid, pattern });
      return;
    }

    if (type === "CIRCLE") {
      const center = entity.center as Point | undefined;
      const radius = Number(entity.radius ?? 0);
      if (!center || radius <= 0) return;
      if (matrixIsIdentity) {
        pushPrimitive({ kind: "circle", layer, center, radius });
        return;
      }

      const transformedCenter = applyPoint(matrix, center);
      const axisX = applyVector(matrix, { x: radius, y: 0 });
      const axisY = applyVector(matrix, { x: 0, y: radius });
      const axisXLen = Math.hypot(axisX.x, axisX.y);
      const axisYLen = Math.hypot(axisY.x, axisY.y);
      if (axisXLen <= 0 || axisYLen <= 0) return;

      if (Math.abs(axisXLen - axisYLen) <= Math.max(axisXLen, axisYLen) * 1e-4) {
        pushPrimitive({
          kind: "circle",
          layer,
          center: transformedCenter,
          radius: (axisXLen + axisYLen) / 2
        });
        return;
      }

      const majorAxisEndPoint = axisXLen >= axisYLen ? axisX : axisY;
      const axisRatio = Math.min(axisXLen, axisYLen) / Math.max(axisXLen, axisYLen);
      pushPrimitive({
        kind: "ellipse",
        layer,
        center: transformedCenter,
        majorAxisEndPoint,
        axisRatio,
        startAngle: 0,
        endAngle: Math.PI * 2
      });
      return;
    }

    if (type === "ARC") {
      const center = entity.center as Point | undefined;
      const radius = Number(entity.radius ?? 0);
      const startAngle = toRadians(Number(entity.startAngle ?? 0));
      const endAngle = toRadians(Number(entity.endAngle ?? 0));
      if (!center || radius <= 0) return;
      if (matrixIsIdentity) {
        pushPrimitive({ kind: "arc", layer, center, radius, startAngle, endAngle });
        return;
      }
      const points = ellipseToPoints(center, { x: radius, y: 0 }, 1, startAngle, endAngle, 72).map((
        point
      ) => applyPoint(matrix, point));
      if (points.length >= 2) {
        pushPrimitive({ kind: "polyline", layer, points, closed: false });
      }
      return;
    }

    if (type === "ELLIPSE") {
      const center = entity.center as Point | undefined;
      const majorAxisEndPoint = entity.majorAxisEndPoint as Point | undefined;
      const axisRatio = Number(entity.axisRatio ?? 1);
      const startAngle = toRadians(Number(entity.startAngle ?? 0));
      const endAngle = toRadians(Number(entity.endAngle ?? Math.PI * 2));
      if (!center || !majorAxisEndPoint || axisRatio <= 0) return;
      if (!matrixIsIdentity) {
        const points = ellipseToPoints(
          center,
          majorAxisEndPoint,
          axisRatio,
          startAngle,
          endAngle,
          90
        ).map((point) => applyPoint(matrix, point));
        if (points.length >= 2) {
          pushPrimitive({ kind: "polyline", layer, points, closed: false });
        }
        return;
      }
      pushPrimitive({
        kind: "ellipse",
        layer,
        center,
        majorAxisEndPoint,
        axisRatio,
        startAngle,
        endAngle
      });
      return;
    }

    if (type === "SPLINE") {
      const fitPoints = Array.isArray(entity.fitPoints) ? (entity.fitPoints as Point[]) : [];
      const controlPoints = Array.isArray(entity.controlPoints)
        ? (entity.controlPoints as Point[])
        : [];
      const sourcePoints = fitPoints.length >= 2 ? fitPoints : controlPoints;
      if (sourcePoints.length < 2) return;
      const points = sourcePoints.map((point) => applyPoint(matrix, { x: point.x, y: point.y }));
      pushPrimitive({ kind: "spline", layer, points });
      return;
    }

    if (type === "TEXT") {
      const position = pickPoint(entity);
      const text = String(entity.text ?? entity.string ?? "").trim();
      if (!position || text.length === 0) return;
      const scaleX = Math.hypot(matrix.a, matrix.b);
      const scaleY = Math.hypot(matrix.c, matrix.d);
      const textScale = Math.max((scaleX + scaleY) / 2, 0.0001);
      const height = Math.max(Number(entity.textHeight ?? entity.height ?? 2.5) * textScale, 0.1);
      const rotation = toRadians(Number(entity.rotation ?? entity.angle ?? 0))
        + Math.atan2(matrix.b, matrix.a);
      pushPrimitive({
        kind: "text",
        layer,
        text,
        position: applyPoint(matrix, position),
        height,
        rotation,
        multiline: false
      });
      return;
    }

    if (type === "MTEXT") {
      const position = pickPoint(entity);
      const source = String(entity.text ?? entity.string ?? "").trim();
      const text = normalizeMText(source);
      if (!position || text.length === 0) return;
      const scaleX = Math.hypot(matrix.a, matrix.b);
      const scaleY = Math.hypot(matrix.c, matrix.d);
      const textScale = Math.max((scaleX + scaleY) / 2, 0.0001);
      const height = Math.max(Number(entity.height ?? entity.textHeight ?? 2.5) * textScale, 0.1);
      const rotation = toRadians(Number(entity.rotation ?? entity.angle ?? 0))
        + Math.atan2(matrix.b, matrix.a);
      pushPrimitive({
        kind: "text",
        layer,
        text,
        position: applyPoint(matrix, position),
        height,
        rotation,
        multiline: true
      });
      return;
    }

    if (type === "INSERT") {
      const blockName = String(entity.name ?? entity.block ?? "").trim();
      if (!blockName) return;
      const block = blocks[blockName];
      if (!block || !Array.isArray(block.entities)) return;
      if (blockStack.includes(blockName)) return;

      const insertion = pickPoint(entity) ?? { x: 0, y: 0 };
      const sx = Number(entity.xScale ?? entity.xscale ?? 1);
      const sy = Number(entity.yScale ?? entity.yscale ?? 1);
      const rotation = toRadians(Number(entity.rotation ?? entity.angle ?? 0));

      const local = multiplyMatrix(
        translationMatrix(insertion.x, insertion.y),
        multiplyMatrix(rotationMatrix(rotation), scaleMatrix(sx, sy))
      );
      const next = multiplyMatrix(matrix, local);

      for (const child of block.entities as Record<string, unknown>[]) {
        expandEntity(child, next, [...blockStack, blockName], depth + 1);
      }

      const attribs = Array.isArray(entity.attribs)
        ? (entity.attribs as Record<string, unknown>[])
        : [];
      for (const attrib of attribs) {
        expandEntity({ ...attrib, type: "TEXT" }, next, blockStack, depth + 1);
      }
      return;
    }

    if (type === "DIMENSION") {
      const blockName = String(entity.block ?? "").trim();
      if (blockName && blocks[blockName] && Array.isArray(blocks[blockName].entities)) {
        for (const child of blocks[blockName].entities as Record<string, unknown>[]) {
          expandEntity(child, matrix, [...blockStack, blockName], depth + 1);
        }
      }
      const dimText = String(entity.text ?? "").trim();
      if (dimText.length > 0 && dimText !== "<>") {
        const position = pickPoint(entity);
        if (position) {
          const scaleX = Math.hypot(matrix.a, matrix.b);
          const scaleY = Math.hypot(matrix.c, matrix.d);
          const height = Math.max(2.5 * ((scaleX + scaleY) / 2), 0.1);
          pushPrimitive({
            kind: "text",
            layer,
            text: dimText,
            position: applyPoint(matrix, position),
            height,
            rotation: Math.atan2(matrix.b, matrix.a),
            multiline: false
          });
        }
      }
      return;
    }
  };

  for (const entity of entities as Record<string, unknown>[]) {
    expandEntity(entity, identityMatrix(), [], 0);
  }

  const bounds = computeBounds(primitives) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const layers = Array.from(layerCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { primitives, bounds, layers };
}

function DxfCanvasViewer({ content }: { content: string; }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panDragRef = useRef<
    {
      pointerId: number;
      startX: number;
      startY: number;
      startPanX: number;
      startPanY: number;
    } | null
  >(null);
  const layerResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; } | null>(
    null
  );

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [layerPanelWidth, setLayerPanelWidth] = useState(320);
  const [layerPanelCollapsed, setLayerPanelCollapsed] = useState(false);

  const { parsed, error } = useMemo(() => {
    try {
      return { parsed: parseDxf(content), error: null as string | null };
    } catch (err) {
      return { parsed: null, error: `Failed to parse DXF: ${String(err)}` };
    }
  }, [content]);

  useEffect(() => {
    if (!parsed) return;
    const allEnabled: Record<string, boolean> = {};
    for (const layer of parsed.layers) {
      allEnabled[layer.name] = true;
    }
    setEnabledLayers(allEnabled);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [parsed]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const resize = () => {
      setViewport({
        width: Math.max(node.clientWidth, 1),
        height: Math.max(node.clientHeight, 1)
      });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const visibleLayers = useMemo(() => {
    if (!parsed) return new Set<string>();
    const next = new Set<string>();
    for (const layer of parsed.layers) {
      if (enabledLayers[layer.name] !== false) {
        next.add(layer.name);
      }
    }
    return next;
  }, [parsed, enabledLayers]);

  const visiblePrimitives = useMemo(() => {
    if (!parsed) return [];
    return parsed.primitives.filter((primitive) => visibleLayers.has(primitive.layer));
  }, [parsed, visibleLayers]);

  const visibleBounds = useMemo(() => computeBounds(visiblePrimitives), [visiblePrimitives]);

  const allLayersEnabled = useMemo(() => {
    if (!parsed || parsed.layers.length === 0) return false;
    return parsed.layers.every((layer) => enabledLayers[layer.name] !== false);
  }, [parsed, enabledLayers]);

  useEffect(() => {
    if (!parsed || !canvasRef.current || !visibleBounds) return;
    if (viewport.width <= 0 || viewport.height <= 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = viewport.width;
    const height = viewport.height;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "var(--bg-main)";
    ctx.fillRect(0, 0, width, height);

    const worldW = Math.max(visibleBounds.maxX - visibleBounds.minX, 1);
    const worldH = Math.max(visibleBounds.maxY - visibleBounds.minY, 1);
    const fitScale = Math.min(width / worldW, height / worldH);
    const scale = Math.max(fitScale * zoom, 0.0001);

    const xOffset = (width - worldW * scale) / 2;
    const yOffset = (height - worldH * scale) / 2;

    const map = (p: Point): Point => ({
      x: xOffset + (p.x - visibleBounds.minX) * scale + pan.x,
      y: height - (yOffset + (p.y - visibleBounds.minY) * scale) + pan.y
    });

    const hatchPrimitives = visiblePrimitives.filter(isHatchPrimitive);
    const strokePrimitives = visiblePrimitives.filter((primitive) => !isHatchPrimitive(primitive));

    for (const primitive of hatchPrimitives) {
      ctx.save();
      const color = layerColor(primitive.layer);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (const loop of primitive.loops) {
        if (loop.length < 3) continue;
        ctx.beginPath();
        const first = map(loop[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < loop.length; i += 1) {
          const p = map(loop[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        if (primitive.solid) {
          ctx.globalAlpha = 0.18;
          ctx.fill("evenodd");
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.save();
        ctx.clip("evenodd");
        ctx.globalAlpha = 0.55;
        strokeHatchPattern(ctx, width, height, primitive.pattern);
        ctx.restore();
      }
      ctx.restore();
    }

    for (const primitive of strokePrimitives) {
      ctx.beginPath();
      ctx.strokeStyle = layerColor(primitive.layer);
      ctx.lineWidth = 1.1;

      if (primitive.kind === "line") {
        const a = map(primitive.start);
        const b = map(primitive.end);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        continue;
      }

      if (primitive.kind === "polyline") {
        const first = map(primitive.points[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < primitive.points.length; i += 1) {
          const p = map(primitive.points[i]);
          ctx.lineTo(p.x, p.y);
        }
        if (primitive.closed) {
          ctx.closePath();
        }
        ctx.stroke();
        continue;
      }

      if (primitive.kind === "circle") {
        const c = map(primitive.center);
        ctx.arc(c.x, c.y, primitive.radius * scale, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      if (primitive.kind === "arc") {
        const c = map(primitive.center);
        ctx.arc(
          c.x,
          c.y,
          primitive.radius * scale,
          -primitive.startAngle,
          -primitive.endAngle,
          true
        );
        ctx.stroke();
        continue;
      }

      if (primitive.kind === "ellipse") {
        const points = ellipseToPoints(
          primitive.center,
          primitive.majorAxisEndPoint,
          primitive.axisRatio,
          primitive.startAngle,
          primitive.endAngle,
          90
        );
        if (points.length < 2) continue;
        const first = map(points[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i += 1) {
          const point = map(points[i]);
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        continue;
      }

      if (primitive.kind === "spline") {
        if (primitive.points.length < 2) continue;
        const first = map(primitive.points[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < primitive.points.length; i += 1) {
          const point = map(primitive.points[i]);
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
        continue;
      }

      if (primitive.kind === "text") {
        const p = map(primitive.position);
        const lines = primitive.text.split("\n");
        const fontSize = Math.max(primitive.height * scale, 9);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-primitive.rotation);
        ctx.fillStyle = layerColor(primitive.layer);
        ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.textAlign = "left";

        if (primitive.multiline) {
          const lineHeight = fontSize * 1.2;
          for (let i = 0; i < lines.length; i += 1) {
            ctx.fillText(lines[i], 0, -(i * lineHeight));
          }
        } else {
          ctx.fillText(primitive.text, 0, 0);
        }

        ctx.restore();
      }
    }
  }, [parsed, visibleBounds, visiblePrimitives, viewport, zoom, pan]);

  if (error) {
    return <p style={{ color: "#f14c4c" }}>{error}</p>;
  }

  if (!parsed || parsed.primitives.length === 0) {
    return <p style={{ color: "var(--text-secondary)" }}>No renderable DXF entities found.</p>;
  }

  const zoomLabel = `${Math.round(zoom * 100)}%`;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 360,
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          cursor: isPanning ? "grabbing" : "grab",
          touchAction: "none"
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          panDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startPanX: pan.x,
            startPanY: pan.y
          };
          setIsPanning(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = panDragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
          setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
        }}
        onPointerUp={(event) => {
          if (panDragRef.current?.pointerId !== event.pointerId) return;
          panDragRef.current = null;
          setIsPanning(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          panDragRef.current = null;
          setIsPanning(false);
        }}
        onWheel={(event) => {
          event.preventDefault();
          setZoom((current) => {
            const next = event.deltaY < 0 ? current * 1.1 : current / 1.1;
            return Math.min(50, Math.max(0.1, next));
          });
        }}
      >
        <canvas ref={canvasRef} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "6px 8px",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          background: "color-mix(in srgb, var(--bg-main) 92%, transparent)",
          backdropFilter: "blur(4px)"
        }}
      >
        <button type="button" onClick={() => setZoom((value) => Math.max(value / 1.25, 0.1))}>
          -
        </button>
        <span style={{ minWidth: 54, textAlign: "center", color: "var(--text-secondary)" }}>
          {zoomLabel}
        </span>
        <button type="button" onClick={() => setZoom((value) => Math.min(value * 1.25, 50))}>
          +
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
      </div>

      <aside
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: layerPanelWidth,
          maxHeight: layerPanelCollapsed ? 46 : "calc(100% - 16px)",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          padding: 8,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          background: "color-mix(in srgb, var(--bg-main) 92%, transparent)",
          backdropFilter: "blur(4px)"
        }}
      >
        {!layerPanelCollapsed && (
          <div
            role="separator"
            aria-label="Resize layer panel"
            onPointerDown={(event) => {
              layerResizeRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: layerPanelWidth
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = layerResizeRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              const diff = drag.startX - event.clientX;
              const nextWidth = Math.min(560, Math.max(220, drag.startWidth + diff));
              setLayerPanelWidth(nextWidth);
            }}
            onPointerUp={(event) => {
              if (layerResizeRef.current?.pointerId !== event.pointerId) return;
              layerResizeRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            style={{
              position: "absolute",
              left: -4,
              top: 0,
              width: 8,
              height: "100%",
              cursor: "ew-resize"
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 6,
            marginBottom: 8
          }}
        >
          {!layerPanelCollapsed && (
            <span
              style={{ color: "var(--text-secondary)", fontSize: 12, textTransform: "uppercase" }}
            >
              DXF Layers
            </span>
          )}
          <button type="button" onClick={() => setLayerPanelCollapsed((prev) => !prev)}>
            {layerPanelCollapsed ? "Expand" : "Collapse"}
          </button>
        </div>

        {!layerPanelCollapsed && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() =>
                  setEnabledLayers(
                    Object.fromEntries(parsed.layers.map((layer) => [layer.name, true]))
                  )}
                disabled={allLayersEnabled}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setLayerPanelWidth((value) => Math.max(220, value - 40))}
              >
                -
              </button>
              <button
                type="button"
                onClick={() => setLayerPanelWidth((value) => Math.min(560, value + 40))}
              >
                +
              </button>
            </div>
            <div
              style={{
                overflowY: "auto",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6
              }}
            >
              {parsed.layers.map((layer) => {
                const checked = enabledLayers[layer.name] !== false;
                return (
                  <label
                    key={layer.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid var(--border-color)",
                      borderRadius: 6,
                      padding: "4px 6px",
                      background: checked ? "var(--bg-hover)" : "transparent"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setEnabledLayers((prev) => ({
                          ...prev,
                          [layer.name]: !(prev[layer.name] !== false)
                        }))}
                    />
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: layerColor(layer.name)
                      }}
                    />
                    <span
                      style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {layer.name}
                    </span>
                    <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                      {layer.count}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </aside>

      {visiblePrimitives.length === 0
        ? (
          <p
            style={{
              position: "absolute",
              left: 8,
              bottom: 8,
              color: "var(--text-secondary)",
              fontSize: 12,
              padding: "4px 8px",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--bg-main) 92%, transparent)"
            }}
          >
            No entities are visible. Enable at least one layer.
          </p>
        )
        : null}
    </div>
  );
}

export const dxfViewerPlugin: ViewerPlugin = {
  id: "dxf",
  label: "DXF",
  extensions: ["dxf"],
  supportsFind: false,
  render({ content }) {
    return <DxfCanvasViewer content={content} />;
  }
};
