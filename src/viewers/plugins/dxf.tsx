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
type StrokeStyle = { dash: number[]; lineWidth: number; alpha: number; color: string; };

type Primitive =
  | { kind: "line"; layer: string; start: Point; end: Point; stroke: StrokeStyle; }
  | { kind: "polyline"; layer: string; points: Point[]; closed: boolean; stroke: StrokeStyle; }
  | {
    kind: "point";
    layer: string;
    position: Point;
    size: number;
    mode: number;
    stroke: StrokeStyle;
  }
  | { kind: "arrow"; layer: string; tip: Point; tail: Point; size: number; stroke: StrokeStyle; }
  | { kind: "face"; layer: string; points: Point[]; }
  | { kind: "hatch"; layer: string; loops: Point[][]; solid: boolean; pattern: HatchPattern; }
  | { kind: "circle"; layer: string; center: Point; radius: number; stroke: StrokeStyle; }
  | {
    kind: "arc";
    layer: string;
    center: Point;
    radius: number;
    startAngle: number;
    endAngle: number;
    stroke: StrokeStyle;
  }
  | {
    kind: "ellipse";
    layer: string;
    center: Point;
    majorAxisEndPoint: Point;
    axisRatio: number;
    startAngle: number;
    endAngle: number;
    stroke: StrokeStyle;
  }
  | { kind: "spline"; layer: string; points: Point[]; stroke: StrokeStyle; }
  | {
    kind: "text";
    layer: string;
    text: string;
    position: Point;
    height: number;
    rotation: number;
    multiline: boolean;
    align: CanvasTextAlign;
    baseline: CanvasTextBaseline;
    widthFactor: number;
    alpha: number;
  };

type LayerSummary = { name: string; count: number; };

interface ParsedDxf {
  primitives: Primitive[];
  bounds: Bounds;
  layers: LayerSummary[];
  layerStroke: Record<string, StrokeStyle>;
  unsupportedEntities: string[];
  renderWarnings: string[];
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

  if (primitive.kind === "face") {
    for (const point of primitive.points) {
      updateBounds(bounds, point);
    }
    return;
  }

  if (primitive.kind === "point") {
    updateBounds(bounds, primitive.position);
    return;
  }

  if (primitive.kind === "arrow") {
    updateBounds(bounds, primitive.tip);
    updateBounds(bounds, primitive.tail);
    const dx = primitive.tail.x - primitive.tip.x;
    const dy = primitive.tail.y - primitive.tip.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const base = {
      x: primitive.tip.x + ux * primitive.size,
      y: primitive.tip.y + uy * primitive.size
    };
    const half = primitive.size * 0.45;
    updateBounds(bounds, { x: base.x + px * half, y: base.y + py * half });
    updateBounds(bounds, { x: base.x - px * half, y: base.y - py * half });
    return;
  }

  if (primitive.kind === "text") {
    const lines = primitive.text.split("\n");
    const maxLine = lines.reduce((acc, line) => Math.max(acc, line.length), 0)
      * primitive.widthFactor;
    const textW = Math.max(maxLine * primitive.height * 0.6, primitive.height);
    const textH = Math.max(lines.length * primitive.height * 1.2, primitive.height);

    let xShift = 0;
    if (primitive.align === "center") xShift = -textW / 2;
    if (primitive.align === "right" || primitive.align === "end") xShift = -textW;
    let yShift = 0;
    if (primitive.baseline === "middle") yShift = textH / 2;
    if (primitive.baseline === "top" || primitive.baseline === "hanging") yShift = textH;

    const corners = [
      { x: xShift, y: yShift },
      { x: xShift + textW, y: yShift },
      { x: xShift + textW, y: yShift - textH },
      { x: xShift, y: yShift - textH }
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

function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToCss(r: number, g: number, b: number): string {
  return `rgb(${toByte(r)} ${toByte(g)} ${toByte(b)})`;
}

function aciColor(index: number): string {
  const aci = Math.floor(index);
  const base: Record<number, [number, number, number]> = {
    0: [255, 255, 255],
    1: [255, 0, 0],
    2: [255, 255, 0],
    3: [0, 255, 0],
    4: [0, 255, 255],
    5: [0, 0, 255],
    6: [255, 0, 255],
    7: [255, 255, 255],
    8: [128, 128, 128],
    9: [192, 192, 192]
  };
  const fixed = base[aci];
  if (fixed) return rgbToCss(fixed[0], fixed[1], fixed[2]);
  const hue = ((Math.abs(aci) - 10) % 24) * 15;
  return `hsl(${hue} 78% 58%)`;
}

function parseTrueColor(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const packed = raw & 0xffffff;
    const r = (packed >> 16) & 0xff;
    const g = (packed >> 8) & 0xff;
    const b = packed & 0xff;
    return rgbToCss(r, g, b);
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(value)) {
      const hex = value.startsWith("#") ? value.slice(1) : value;
      const packed = Number.parseInt(hex, 16);
      const r = (packed >> 16) & 0xff;
      const g = (packed >> 8) & 0xff;
      const b = packed & 0xff;
      return rgbToCss(r, g, b);
    }
  }
  if (raw && typeof raw === "object") {
    const value = raw as {
      r?: unknown;
      g?: unknown;
      b?: unknown;
      red?: unknown;
      green?: unknown;
      blue?: unknown;
    };
    const r = Number(value.r ?? value.red);
    const g = Number(value.g ?? value.green);
    const b = Number(value.b ?? value.blue);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return rgbToCss(r, g, b);
    }
  }
  return null;
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

function asPoint(raw: unknown): Point | null {
  if (!raw || typeof raw !== "object") return null;
  const point = raw as { x?: unknown; y?: unknown; };
  if (typeof point.x !== "number" || typeof point.y !== "number") return null;
  return { x: point.x, y: point.y };
}

function pointDistanceToSegment(point: Point, start: Point, end: Point): number {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const wx = point.x - start.x;
  const wy = point.y - start.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);
  if (c2 <= c1) return Math.hypot(point.x - end.x, point.y - end.y);
  const t = c1 / c2;
  const proj = { x: start.x + t * vx, y: start.y + t * vy };
  return Math.hypot(point.x - proj.x, point.y - proj.y);
}

function decodeCadTextEscapes(raw: string): string {
  return raw
    .replace(/%%([dDpPcC%])/g, (_, token: string) => {
      const code = token.toUpperCase();
      if (code === "D") return "°";
      if (code === "P") return "±";
      if (code === "C") return "⌀";
      return "%";
    })
    .replace(/\\~/g, " ")
    .replace(/\\\\/g, "\\");
}

function normalizeStackFraction(value: string): string {
  const text = value.trim();
  if (text.length === 0) return "";
  const separators = ["^", "#", "/"];
  for (const sep of separators) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx < text.length - 1) {
      const left = text.slice(0, idx).trim();
      const right = text.slice(idx + 1).trim();
      if (left.length > 0 && right.length > 0) {
        return `${left}/${right}`;
      }
    }
  }
  return text;
}

function normalizeMText(raw: string): string {
  const flattened = decodeCadTextEscapes(raw)
    .replace(/\\P/gi, "\n")
    .replace(/\\X/gi, "\n")
    .replace(/\\S([^;]*);/gi, (_, stack: string) => normalizeStackFraction(stack))
    .replace(/\\(A|C|F|H|Q|T|W|L|l|O|o|K|k)[^;]*;/g, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\r/g, "");
  return flattened
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function readEntityText(entity: Record<string, unknown>, multiline: boolean): string {
  const textCandidates = [
    entity.text,
    entity.string,
    entity.value,
    entity.defaultValue,
    entity.prompt,
    entity.tag
  ];
  for (const candidate of textCandidates) {
    const value = String(candidate ?? "").trim();
    if (value.length === 0) continue;
    const decoded = decodeCadTextEscapes(value);
    return multiline ? normalizeMText(decoded) : decoded;
  }
  return "";
}

function textAlignmentFromTextEntity(entity: Record<string, unknown>): {
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
} {
  const h = Number(entity.halign ?? entity.horizontalAlignment ?? entity.attachmentPoint ?? 0);
  const v = Number(entity.valign ?? entity.verticalAlignment ?? 0);
  let align: CanvasTextAlign = "left";
  let baseline: CanvasTextBaseline = "bottom";

  if (h === 1 || h === 4) align = "center";
  if (h === 2 || h === 5) align = "right";
  if (h === 3) align = "left";

  if (v === 1) baseline = "bottom";
  if (v === 2) baseline = "middle";
  if (v === 3) baseline = "top";
  return { align, baseline };
}

function textAlignmentFromMTextEntity(entity: Record<string, unknown>): {
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
} {
  const attachment = Math.floor(Number(entity.attachmentPoint ?? 7));
  const col = ((attachment - 1) % 3) + 1;
  const row = Math.floor((attachment - 1) / 3) + 1;
  let align: CanvasTextAlign = "left";
  let baseline: CanvasTextBaseline = "top";
  if (col === 2) align = "center";
  if (col === 3) align = "right";
  if (row === 2) baseline = "middle";
  if (row === 3) baseline = "bottom";
  return { align, baseline };
}

function normalizeDashPattern(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const values = raw
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && Math.abs(value) > 1e-9)
    .map((value) => Math.max(Math.abs(value), 0.1));
  if (values.length < 2) return [];
  if (values.length % 2 === 1) values.push(values[values.length - 1]);
  return values;
}

function extractLineTypePatterns(
  tables: Record<string, unknown> | undefined
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const ltypeTable = (tables?.ltype ?? tables?.lineType ?? null) as Record<string, unknown> | null;
  const ltypes = (ltypeTable?.ltypes ?? ltypeTable?.items ?? null) as
    | Record<string, Record<string, unknown>>
    | null;
  if (ltypes && typeof ltypes === "object") {
    for (const [name, value] of Object.entries(ltypes)) {
      const dash = normalizeDashPattern(
        value.pattern ?? value.patterns ?? value.elements ?? value.dashArray
      );
      if (dash.length > 0) out[name.toUpperCase()] = dash;
    }
  }

  if (!out.DASHED) out.DASHED = [6, 3];
  if (!out.HIDDEN) out.HIDDEN = [4, 2];
  if (!out.CENTER) out.CENTER = [10, 3, 2, 3];
  if (!out.PHANTOM) out.PHANTOM = [10, 3, 2, 3, 2, 3];
  return out;
}

function extractLayerLineTypes(
  tables: Record<string, unknown> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  const layerTable = (tables?.layer ?? tables?.layers ?? null) as Record<string, unknown> | null;
  const layers = (layerTable?.layers ?? layerTable?.items ?? null) as
    | Record<string, Record<string, unknown>>
    | null;
  if (!layers || typeof layers !== "object") return out;
  for (const [name, value] of Object.entries(layers)) {
    const lineType = String(value.lineTypeName ?? value.lineType ?? value.ltype ?? "CONTINUOUS");
    out[name] = lineType.toUpperCase();
  }
  return out;
}

function extractLayerLineWeights(
  tables: Record<string, unknown> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  const layerTable = (tables?.layer ?? tables?.layers ?? null) as Record<string, unknown> | null;
  const layers = (layerTable?.layers ?? layerTable?.items ?? null) as
    | Record<string, Record<string, unknown>>
    | null;
  if (!layers || typeof layers !== "object") return out;
  for (const [name, value] of Object.entries(layers)) {
    const raw = Number(value.lineWeight ?? value.lineweight ?? -1);
    if (Number.isFinite(raw) && raw >= 0) out[name] = raw;
  }
  return out;
}

function extractLayerTransparency(
  tables: Record<string, unknown> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  const layerTable = (tables?.layer ?? tables?.layers ?? null) as Record<string, unknown> | null;
  const layers = (layerTable?.layers ?? layerTable?.items ?? null) as
    | Record<string, Record<string, unknown>>
    | null;
  if (!layers || typeof layers !== "object") return out;
  for (const [name, value] of Object.entries(layers)) {
    const raw = Number(value.transparency ?? value.alpha ?? Number.NaN);
    if (Number.isFinite(raw)) out[name] = raw;
  }
  return out;
}

function extractLayerColors(
  tables: Record<string, unknown> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  const layerTable = (tables?.layer ?? tables?.layers ?? null) as Record<string, unknown> | null;
  const layers = (layerTable?.layers ?? layerTable?.items ?? null) as
    | Record<string, Record<string, unknown>>
    | null;
  if (!layers || typeof layers !== "object") return out;
  for (const [name, value] of Object.entries(layers)) {
    const trueColor = parseTrueColor(value.trueColor ?? value.color24 ?? value.rgb);
    if (trueColor) {
      out[name] = trueColor;
      continue;
    }
    const aci = Number(value.colorNumber ?? value.colorIndex ?? value.color ?? value.aci);
    if (Number.isFinite(aci) && aci > 0 && aci < 256) {
      out[name] = aciColor(aci);
      continue;
    }
    out[name] = aciColor(7);
  }
  return out;
}

function getGlobalLineTypeScale(header: Record<string, unknown> | undefined): number {
  if (!header || typeof header !== "object") return 1;
  const candidates = [header.$LTSCALE, header.ltscale, header.LTSCALE];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const value = Number((candidate as { value?: unknown; }).value);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 1;
}

function lineWeightToPixels(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 1.1;
  const mm = raw / 100;
  const px = mm * (96 / 25.4);
  return Math.min(8, Math.max(0.7, px));
}

function transparencyToAlpha(raw: number | undefined): number {
  if (!Number.isFinite(raw)) return 1;
  const value = Number(raw);
  if (value >= 0 && value <= 1) return Math.min(1, Math.max(0, value));
  if (value >= 0 && value <= 255) return Math.min(1, Math.max(0, 1 - value / 255));
  const t = value & 0xff;
  return Math.min(1, Math.max(0, 1 - t / 255));
}

function resolveStrokeStyle(
  entity: Record<string, unknown>,
  layer: string,
  lineTypePatterns: Record<string, number[]>,
  layerLineTypes: Record<string, string>,
  layerLineWeights: Record<string, number>,
  layerTransparency: Record<string, number>,
  layerColors: Record<string, string>,
  globalLineTypeScale: number,
  parentStroke?: StrokeStyle
): StrokeStyle {
  const rawType = String(
    entity.lineTypeName ?? entity.lineType ?? entity.ltype ?? "BYLAYER"
  ).toUpperCase();
  const lineTypeName = rawType === "BYLAYER" || rawType === "BYBLOCK"
    ? (layerLineTypes[layer] ?? "CONTINUOUS")
    : rawType;
  const entityLineTypeScale = Number(
    entity.lineTypeScale ?? entity.linetypeScale ?? entity.ltypeScale ?? entity.ltscale ?? 1
  );
  const lineTypeScale = Number.isFinite(entityLineTypeScale) && entityLineTypeScale > 0
    ? entityLineTypeScale
    : 1;
  const baseDash = lineTypePatterns[lineTypeName] ?? [];
  const dash = rawType === "BYBLOCK" && parentStroke
    ? parentStroke.dash
    : baseDash.map((value) => value * lineTypeScale * globalLineTypeScale);

  const rawLineWeight = Number(entity.lineWeight ?? entity.lineweight ?? -1);
  let lineWeightValue = layerLineWeights[layer] ?? -1;
  if (Number.isFinite(rawLineWeight)) {
    if (rawLineWeight >= 0) lineWeightValue = rawLineWeight;
  }
  const lineWidth = rawLineWeight === -2 && parentStroke
    ? parentStroke.lineWidth
    : lineWeightToPixels(lineWeightValue);

  const rawTransparency = Number(entity.transparency ?? entity.alpha ?? Number.NaN);
  const transparencyValue = Number.isFinite(rawTransparency)
    ? rawTransparency
    : layerTransparency[layer];
  const alpha = Number.isFinite(transparencyValue)
    ? transparencyToAlpha(transparencyValue)
    : (parentStroke?.alpha ?? 1);

  const trueColor = parseTrueColor(entity.trueColor ?? entity.color24 ?? entity.rgb);
  const rawAci = Number(entity.colorNumber ?? entity.colorIndex ?? entity.color ?? entity.aci);
  const defaultLayerColor = layerColors[layer] ?? aciColor(7);
  let color = defaultLayerColor;
  if (trueColor) {
    color = trueColor;
  } else if (Number.isFinite(rawAci)) {
    if (rawAci === 0) color = parentStroke?.color ?? defaultLayerColor;
    else if (rawAci === 256 || rawAci < 0) color = defaultLayerColor;
    else if (rawAci > 0 && rawAci < 256) color = aciColor(rawAci);
  }
  if (rawType === "BYBLOCK" && parentStroke) {
    color = parentStroke.color;
  }

  return { dash, lineWidth, alpha, color };
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

type WeightedPoint = { x: number; y: number; w: number; };

function generateOpenUniformKnots(controlCount: number, degree: number): number[] {
  const knotCount = controlCount + degree + 1;
  const interior = knotCount - 2 * (degree + 1);
  const knots: number[] = [];
  for (let i = 0; i <= degree; i += 1) knots.push(0);
  for (let i = 1; i <= interior; i += 1) knots.push(i / (interior + 1));
  for (let i = 0; i <= degree; i += 1) knots.push(1);
  return knots;
}

function normalizeSplineKnots(raw: unknown, controlCount: number, degree: number): number[] {
  const expected = controlCount + degree + 1;
  const values = Array.isArray(raw)
    ? raw.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  if (values.length < expected) {
    return generateOpenUniformKnots(controlCount, degree);
  }
  const knots = values.slice(0, expected);
  for (let i = 1; i < knots.length; i += 1) {
    if (knots[i] < knots[i - 1]) {
      knots.sort((a, b) => a - b);
      break;
    }
  }
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || Math.abs(last - first) < 1e-9) {
    return generateOpenUniformKnots(controlCount, degree);
  }
  return knots;
}

function findKnotSpan(u: number, knots: number[], controlCount: number, degree: number): number {
  const n = controlCount - 1;
  if (u >= knots[n + 1]) return n;
  if (u <= knots[degree]) return degree;
  let low = degree;
  let high = n + 1;
  let mid = Math.floor((low + high) / 2);
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) {
      high = mid;
    } else {
      low = mid;
    }
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

function evaluateNurbsPoint(
  controlPoints: WeightedPoint[],
  degree: number,
  knots: number[],
  u: number
): Point | null {
  const count = controlPoints.length;
  if (count === 0) return null;
  const span = findKnotSpan(u, knots, count, degree);
  const d: WeightedPoint[] = [];
  for (let j = 0; j <= degree; j += 1) {
    const source = controlPoints[span - degree + j];
    d.push({ x: source.x, y: source.y, w: source.w });
  }
  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const i = span - degree + j;
      const left = knots[i];
      const right = knots[i + degree - r + 1];
      const denom = right - left;
      const alpha = Math.abs(denom) < 1e-12 ? 0 : (u - left) / denom;
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        w: (1 - alpha) * d[j - 1].w + alpha * d[j].w
      };
    }
  }
  const out = d[degree];
  if (!Number.isFinite(out.w) || Math.abs(out.w) < 1e-12) return null;
  return { x: out.x / out.w, y: out.y / out.w };
}

function splineToPolyline(entity: Record<string, unknown>): Point[] {
  const fitPoints = Array.isArray(entity.fitPoints) ? (entity.fitPoints as Point[]) : [];
  const controlPoints = Array.isArray(entity.controlPoints)
    ? (entity.controlPoints as Point[])
    : [];
  if (controlPoints.length < 2 && fitPoints.length < 2) return [];

  if (controlPoints.length >= 2) {
    const maxDegree = Math.max(controlPoints.length - 1, 1);
    const degree = Math.min(
      maxDegree,
      Math.max(1, Math.floor(Number(entity.degree ?? entity.order ?? 3)))
    );
    const weightsRaw = Array.isArray(entity.weights) ? (entity.weights as unknown[]) : [];
    const weightedControl = controlPoints.map((point, idx) => {
      const rawWeight = Number(weightsRaw[idx] ?? 1);
      const weight = Number.isFinite(rawWeight) && Math.abs(rawWeight) > 1e-9 ? rawWeight : 1;
      return { x: point.x * weight, y: point.y * weight, w: weight };
    });
    const knots = normalizeSplineKnots(
      entity.knotValues ?? entity.knots ?? entity.knotVector,
      controlPoints.length,
      degree
    );
    const minU = knots[degree];
    const maxU = knots[controlPoints.length];
    if (Number.isFinite(minU) && Number.isFinite(maxU) && maxU > minU) {
      const controlBounds = emptyBounds();
      for (const p of controlPoints) {
        updateBounds(controlBounds, p);
      }
      const diag = Math.hypot(
        controlBounds.maxX - controlBounds.minX,
        controlBounds.maxY - controlBounds.minY
      );
      const tolerance = Math.max(diag / 2000, 1e-4);
      const maxDepth = 11;
      const points: Point[] = [];

      const refine = (u0: number, p0: Point, u1: number, p1: Point, depth: number) => {
        if (depth >= maxDepth) {
          points.push(p1);
          return;
        }
        const um = (u0 + u1) / 2;
        const pm = evaluateNurbsPoint(weightedControl, degree, knots, um);
        if (!pm) {
          points.push(p1);
          return;
        }
        const deviation = pointDistanceToSegment(pm, p0, p1);
        if (deviation <= tolerance) {
          points.push(p1);
          return;
        }
        refine(u0, p0, um, pm, depth + 1);
        refine(um, pm, u1, p1, depth + 1);
      };

      const spanStart = degree;
      const spanEnd = controlPoints.length - 1;
      let started = false;
      for (let i = spanStart; i <= spanEnd; i += 1) {
        const u0 = knots[i];
        const u1 = knots[i + 1];
        if (!Number.isFinite(u0) || !Number.isFinite(u1) || u1 - u0 <= 1e-10) continue;
        const p0 = evaluateNurbsPoint(weightedControl, degree, knots, u0);
        const p1 = evaluateNurbsPoint(weightedControl, degree, knots, u1);
        if (!p0 || !p1) continue;
        if (!started) {
          points.push(p0);
          started = true;
        }
        refine(u0, p0, u1, p1, 0);
      }
      const deduped = dedupeSequentialPoints(points);
      if (deduped.length >= 2) return deduped;
    }
  }

  const fallback = fitPoints.length >= 2 ? fitPoints : controlPoints;
  return dedupeSequentialPoints(fallback.map((point) => ({ x: point.x, y: point.y })));
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
        const points = splineToPolyline(edge);
        if (points.length < 2) continue;
        appendSegmentPoints(loopPoints, transformPoints(points, matrix));
      }
    }

    if (loopPoints.length >= 3) {
      loops.push(loopPoints);
    }
  }

  return loops.filter((loop) => loop.length >= 3);
}

function toPointArray(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  const points: Point[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const point = item as { x?: unknown; y?: unknown; };
    if (typeof point.x === "number" && typeof point.y === "number") {
      points.push({ x: point.x, y: point.y });
    }
  }
  return points;
}

function extractFacePoints(entity: Record<string, unknown>): Point[] {
  const fromVertices = toPointArray(entity.vertices);
  if (fromVertices.length >= 3) return fromVertices;

  const fromPoints = toPointArray(entity.points);
  if (fromPoints.length >= 3) return fromPoints;

  const keys = [
    "v0",
    "v1",
    "v2",
    "v3",
    "firstCorner",
    "secondCorner",
    "thirdCorner",
    "fourthCorner"
  ];
  const points: Point[] = [];
  for (const key of keys) {
    const value = entity[key];
    if (!value || typeof value !== "object") continue;
    const point = value as { x?: unknown; y?: unknown; };
    if (typeof point.x === "number" && typeof point.y === "number") {
      points.push({ x: point.x, y: point.y });
    }
  }
  return points;
}

function dedupeSequentialPoints(points: Point[]): Point[] {
  if (points.length === 0) return points;
  const deduped: Point[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = deduped[deduped.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > 1e-9) {
      deduped.push(curr);
    }
  }
  if (deduped.length >= 2) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9) {
      deduped.pop();
    }
  }
  return deduped;
}

function extractLeaderPoints(entity: Record<string, unknown>): Point[] {
  const direct = toPointArray(entity.vertices);
  if (direct.length >= 2) return direct;

  const points = toPointArray(entity.points);
  if (points.length >= 2) return points;

  const leaderLines = Array.isArray(entity.leaderLines)
    ? (entity.leaderLines as Record<string, unknown>[])
    : [];
  for (const leader of leaderLines) {
    const leaderPoints = toPointArray(leader.vertices);
    if (leaderPoints.length >= 2) return leaderPoints;
  }

  const contextData = Array.isArray(entity.contextData)
    ? (entity.contextData as Record<string, unknown>[])
    : [];
  for (const context of contextData) {
    const contextPoints = toPointArray(context.vertices);
    if (contextPoints.length >= 2) return contextPoints;
  }

  const start = pickPoint(entity);
  const endRaw = entity.end as Point | undefined;
  if (start && endRaw && typeof endRaw.x === "number" && typeof endRaw.y === "number") {
    return [start, { x: endRaw.x, y: endRaw.y }];
  }

  return [];
}

function toVector(raw: unknown): Point | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { x?: unknown; y?: unknown; };
  if (typeof value.x !== "number" || typeof value.y !== "number") return null;
  return { x: value.x, y: value.y };
}

function getLeaderArrowSize(entity: Record<string, unknown>, matrix: Matrix2D): number {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  const avgScale = Math.max((scaleX + scaleY) / 2, 0.0001);
  const raw = Number(
    entity.arrowHeadSize
      ?? entity.arrowSize
      ?? entity.dimasz
      ?? entity.dimensionArrowSize
      ?? entity.dimScale
      ?? 2.5
  );
  return Math.max(Math.abs(raw) * avgScale, 0.1);
}

function hasLeaderArrow(entity: Record<string, unknown>): boolean {
  const explicit = entity.hasArrowHead ?? entity.arrowHeadOn ?? entity.enableArrowHead;
  if (typeof explicit === "boolean") return explicit;
  return true;
}

function extractLeaderLandingPoint(
  entity: Record<string, unknown>,
  matrix: Matrix2D,
  leaderEnd: Point
): Point | null {
  const directCandidates = [
    entity.landingPoint,
    entity.doglegPoint,
    entity.lastLeaderPoint,
    entity.textAttachmentPoint
  ];
  for (const candidate of directCandidates) {
    const point = asPoint(candidate);
    if (!point) continue;
    const mapped = applyPoint(matrix, point);
    if (Math.hypot(mapped.x - leaderEnd.x, mapped.y - leaderEnd.y) > 1e-6) {
      return mapped;
    }
  }

  const contexts = Array.isArray(entity.contextData)
    ? (entity.contextData as Record<string, unknown>[])
    : [];
  for (const context of contexts) {
    const contextCandidates = [
      context.landingPoint,
      context.doglegPoint,
      context.lastLeaderPoint,
      context.textAttachmentPoint
    ];
    for (const candidate of contextCandidates) {
      const point = asPoint(candidate);
      if (!point) continue;
      const mapped = applyPoint(matrix, point);
      if (Math.hypot(mapped.x - leaderEnd.x, mapped.y - leaderEnd.y) > 1e-6) {
        return mapped;
      }
    }

    const doglegVecRaw = toVector(context.doglegVector) ?? toVector(entity.doglegVector);
    const doglegLengthRaw = Number(
      context.doglegLength ?? entity.doglegLength ?? entity.landingGap ?? 0
    );
    if (doglegVecRaw && Number.isFinite(doglegLengthRaw) && Math.abs(doglegLengthRaw) > 1e-9) {
      const vec = applyVector(matrix, doglegVecRaw);
      const len = Math.hypot(vec.x, vec.y);
      if (len > 1e-9) {
        const unit = { x: vec.x / len, y: vec.y / len };
        const length = Math.abs(doglegLengthRaw);
        return {
          x: leaderEnd.x + unit.x * length,
          y: leaderEnd.y + unit.y * length
        };
      }
    }
  }

  return null;
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
  const patternScale = Math.max(Math.abs(Number(entity.patternScale ?? entity.scale ?? 1)), 0.1);
  const patternAngleOffset = toRadians(Number(entity.patternAngle ?? entity.angle ?? 0));
  const isDouble = Boolean(entity.patternDouble ?? entity.isDouble);
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
        if (Math.abs(value) < 1e-9) return 0.1;
        return Math.max(Math.abs(value) * patternScale, 0.1);
      });
    return dash.length >= 2 ? dash : [];
  };

  const createPatternLine = (
    def: Record<string, unknown>,
    extraAngleOffset = 0
  ): HatchPatternLine | null => {
    const angle = toRadians(Number(def.angle ?? 45)) + patternAngleOffset + extraAngleOffset;
    const dirX = Math.cos(angle);
    const dirY = -Math.sin(angle);
    const nX = -dirY;
    const nY = dirX;
    const dx = Number(def.deltaX ?? def.offsetX ?? 0) * patternScale;
    const dy = Number(def.deltaY ?? def.offsetY ?? 0) * patternScale;
    const spacingFromDelta = Math.abs(dx * nX + dy * nY);
    const spacingFromField = Number(def.spacing ?? 1) * patternScale;
    const spacing = Math.max(Math.abs(spacingFromDelta || spacingFromField), 0.1);

    const originX = Number(def.x ?? def.originX ?? def.baseX ?? 0) * patternScale;
    const originY = Number(def.y ?? def.originY ?? def.baseY ?? 0) * patternScale;
    const dashOffset = Number(def.dashOffset ?? 0) * patternScale;
    if (!Number.isFinite(spacing) || spacing <= 0) return null;
    return {
      angle,
      spacing,
      originX: Number.isFinite(originX) ? originX : 0,
      originY: Number.isFinite(originY) ? originY : 0,
      dash: toDash(def),
      dashOffset: Number.isFinite(dashOffset) ? dashOffset : 0
    };
  };

  const lines: HatchPatternLine[] = [];
  for (const def of definitionLines) {
    const line = createPatternLine(def, 0);
    if (line) lines.push(line);
    if (isDouble) {
      const orthogonal = createPatternLine(def, Math.PI / 2);
      if (orthogonal) lines.push(orthogonal);
    }
  }

  if (lines.length === 0) {
    const angle = patternAngleOffset || toRadians(45);
    const spacing = patternScale;
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

function signedLoopArea(loop: Point[]): number {
  if (loop.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function normalizeHatchLoops(loops: Point[][]): Point[][] {
  if (!Array.isArray(loops) || loops.length === 0) return loops;

  const polygonLoops = loops
    .map((loop) => loop.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    .filter((loop) => loop.length >= 3);
  if (polygonLoops.length <= 1) return polygonLoops;

  const ordered = polygonLoops
    .map((loop, idx) => ({
      idx,
      loop,
      area: signedLoopArea(loop),
      absArea: Math.abs(signedLoopArea(loop))
    }))
    .sort((a, b) => b.absArea - a.absArea);

  const depth = Array.from({ length: ordered.length }, () => 0);
  for (let i = 0; i < ordered.length; i += 1) {
    const probe = ordered[i].loop[0];
    let parentDepth = -1;
    let parentArea = Number.POSITIVE_INFINITY;
    for (let j = 0; j < ordered.length; j += 1) {
      if (i === j) continue;
      if (ordered[j].absArea <= ordered[i].absArea) continue;
      if (!pointInPolygon(probe, ordered[j].loop)) continue;
      if (ordered[j].absArea < parentArea) {
        parentArea = ordered[j].absArea;
        parentDepth = depth[j];
      }
    }
    depth[i] = parentDepth + 1;
  }

  return ordered.map((entry, idx) => {
    const isOuter = depth[idx] % 2 === 0;
    const isCcw = entry.area > 0;
    if ((isOuter && isCcw) || (!isOuter && !isCcw)) {
      return entry.loop;
    }
    return [...entry.loop].reverse();
  });
}

function strokeHatchPattern(
  ctx: CanvasRenderingContext2D,
  map: (p: Point) => Point,
  bounds: Bounds,
  pattern: HatchPattern,
  scale: number
) {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];

  const drawPatternLine = (line: HatchPatternLine) => {
    const dirX = Math.cos(line.angle);
    const dirY = Math.sin(line.angle);
    const nX = -dirY;
    const nY = dirX;

    const base = { x: line.originX, y: line.originY };
    const baseNormal = base.x * nX + base.y * nY;

    let normalMin = Number.POSITIVE_INFINITY;
    let normalMax = Number.NEGATIVE_INFINITY;
    let alongMin = Number.POSITIVE_INFINITY;
    let alongMax = Number.NEGATIVE_INFINITY;
    for (const corner of corners) {
      const normal = corner.x * nX + corner.y * nY;
      const along = corner.x * dirX + corner.y * dirY;
      normalMin = Math.min(normalMin, normal);
      normalMax = Math.max(normalMax, normal);
      alongMin = Math.min(alongMin, along);
      alongMax = Math.max(alongMax, along);
    }

    const spacing = Math.max(line.spacing, 1e-4);
    const start = Math.floor((normalMin - baseNormal) / spacing) - 1;
    const end = Math.ceil((normalMax - baseNormal) / spacing) + 1;
    const alongPad = Math.max((alongMax - alongMin) * 0.15, 1);

    const dashPixels = line.dash.map((value) => Math.max(value * scale, 1));
    ctx.setLineDash(dashPixels.length >= 2 ? dashPixels : []);
    ctx.lineDashOffset = line.dashOffset * scale;
    ctx.beginPath();
    for (let k = start; k <= end; k += 1) {
      const normal = baseNormal + k * spacing;
      const p0 = {
        x: nX * normal + dirX * (alongMin - alongPad),
        y: nY * normal + dirY * (alongMin - alongPad)
      };
      const p1 = {
        x: nX * normal + dirX * (alongMax + alongPad),
        y: nY * normal + dirY * (alongMax + alongPad)
      };
      const s = map(p0);
      const e = map(p1);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
    }
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
      tables?: Record<string, unknown>;
      header?: Record<string, unknown>;
    }
    | null
    | undefined;
  if (!result || typeof result !== "object") {
    throw new Error("DXF parser returned no document. Binary DXF may not be supported.");
  }

  const entities = Array.isArray(result.entities) ? result.entities : [];
  const blocks = result.blocks && typeof result.blocks === "object" ? result.blocks : {};
  const tables = result.tables && typeof result.tables === "object" ? result.tables : undefined;
  const lineTypePatterns = extractLineTypePatterns(tables);
  const layerLineTypes = extractLayerLineTypes(tables);
  const layerLineWeights = extractLayerLineWeights(tables);
  const layerTransparency = extractLayerTransparency(tables);
  const layerColors = extractLayerColors(tables);
  const globalLineTypeScale = getGlobalLineTypeScale(
    result.header && typeof result.header === "object" ? result.header : undefined
  );

  const primitives: Primitive[] = [];
  const layerCounts = new Map<string, number>();
  const unsupportedEntities = new Set<string>();
  const warningSet = new Set<string>();

  const pushPrimitive = (primitive: Primitive) => {
    primitives.push(primitive);
    layerCounts.set(primitive.layer, (layerCounts.get(primitive.layer) ?? 0) + 1);
  };
  const parseDimensionText = (
    entity: Record<string, unknown>,
    measurement: number
  ): string | null => {
    const raw = String(entity.text ?? "");
    if (raw === " ") return null;
    const precisionRaw = Number(entity.dimdec ?? entity.decimalPlaces ?? 2);
    const precision = Math.min(
      8,
      Math.max(
        0,
        Math.floor(
          Number.isFinite(precisionRaw)
            ? precisionRaw
            : 2
        )
      )
    );
    const factorRaw = Number(entity.dimlfac ?? entity.linearFactor ?? 1);
    const factor = Number.isFinite(factorRaw) && Math.abs(factorRaw) > 1e-9 ? factorRaw : 1;
    const valueText = (measurement * factor).toFixed(precision);
    const postfix = String(entity.dimpost ?? entity.dimensionPostfix ?? "");
    if (raw.trim().length === 0 || raw.includes("<>")) {
      const template = raw.trim().length === 0 ? "<>" : raw;
      return decodeCadTextEscapes(template.split("<>").join(valueText)).trim();
    }
    if (postfix.includes("<>")) {
      return decodeCadTextEscapes(postfix.split("<>").join(valueText)).trim();
    }
    return decodeCadTextEscapes(raw).trim();
  };

  const expandEntity = (
    entity: Record<string, unknown>,
    matrix: Matrix2D,
    blockStack: string[],
    depth: number,
    inheritedStroke?: StrokeStyle
  ) => {
    if (depth > 10) {
      warningSet.add("Entity expansion depth exceeded (possible recursive block references).");
      return;
    }

    const type = String(entity.type ?? "");
    const layer = getLayerName(entity.layer);
    const matrixIsIdentity = isIdentityMatrix(matrix);
    const stroke = resolveStrokeStyle(
      entity,
      layer,
      lineTypePatterns,
      layerLineTypes,
      layerLineWeights,
      layerTransparency,
      layerColors,
      globalLineTypeScale,
      inheritedStroke
    );

    if (type === "LINE") {
      const start = entity.start as Point | undefined;
      const end = entity.end as Point | undefined;
      if (!start || !end) return;
      pushPrimitive({
        kind: "line",
        layer,
        start: applyPoint(matrix, start),
        end: applyPoint(matrix, end),
        stroke
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
      pushPrimitive({ kind: "polyline", layer, points, closed, stroke });
      return;
    }

    if (type === "HATCH") {
      const loops = normalizeHatchLoops(extractHatchLoops(entity, matrix));
      if (loops.length === 0) return;
      const { solid, pattern } = extractHatchPattern(entity);
      pushPrimitive({ kind: "hatch", layer, loops, solid, pattern });
      return;
    }

    if (type === "3DFACE" || type === "SOLID" || type === "TRACE") {
      const points = dedupeSequentialPoints(transformPoints(extractFacePoints(entity), matrix));
      if (points.length < 3) return;
      pushPrimitive({ kind: "face", layer, points });
      return;
    }

    if (type === "LEADER" || type === "MLEADER") {
      const points = dedupeSequentialPoints(transformPoints(extractLeaderPoints(entity), matrix));
      if (points.length < 2) return;
      pushPrimitive({ kind: "polyline", layer, points, closed: false, stroke });
      if (hasLeaderArrow(entity)) {
        pushPrimitive({
          kind: "arrow",
          layer,
          tip: points[0],
          tail: points[1],
          size: getLeaderArrowSize(entity, matrix),
          stroke
        });
      }
      const landing = extractLeaderLandingPoint(entity, matrix, points[points.length - 1]);
      if (landing) {
        pushPrimitive({
          kind: "line",
          layer,
          start: points[points.length - 1],
          end: landing,
          stroke
        });
      }
      return;
    }

    if (type === "CIRCLE") {
      const center = entity.center as Point | undefined;
      const radius = Number(entity.radius ?? 0);
      if (!center || radius <= 0) return;
      if (matrixIsIdentity) {
        pushPrimitive({ kind: "circle", layer, center, radius, stroke });
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
          radius: (axisXLen + axisYLen) / 2,
          stroke
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
        endAngle: Math.PI * 2,
        stroke
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
        pushPrimitive({ kind: "arc", layer, center, radius, startAngle, endAngle, stroke });
        return;
      }
      const points = ellipseToPoints(center, { x: radius, y: 0 }, 1, startAngle, endAngle, 72).map((
        point
      ) => applyPoint(matrix, point));
      if (points.length >= 2) {
        pushPrimitive({ kind: "polyline", layer, points, closed: false, stroke });
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
          pushPrimitive({ kind: "polyline", layer, points, closed: false, stroke });
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
        endAngle,
        stroke
      });
      return;
    }

    if (type === "SPLINE") {
      const splinePoints = splineToPolyline(entity);
      if (splinePoints.length < 2) return;
      const points = splinePoints.map((point) => applyPoint(matrix, point));
      pushPrimitive({ kind: "spline", layer, points, stroke });
      return;
    }

    if (type === "TEXT" || type === "ATTRIB" || type === "ATTDEF") {
      const position = pickPoint(entity);
      const text = readEntityText(entity, false);
      if (!position || text.length === 0) return;
      const scaleX = Math.hypot(matrix.a, matrix.b);
      const scaleY = Math.hypot(matrix.c, matrix.d);
      const textScale = Math.max((scaleX + scaleY) / 2, 0.0001);
      const height = Math.max(Number(entity.textHeight ?? entity.height ?? 2.5) * textScale, 0.1);
      const rotation = toRadians(Number(entity.rotation ?? entity.angle ?? 0))
        + Math.atan2(matrix.b, matrix.a);
      const { align, baseline } = textAlignmentFromTextEntity(entity);
      const widthFactor = Math.max(Math.abs(Number(entity.xScale ?? entity.widthFactor ?? 1)), 0.1);
      pushPrimitive({
        kind: "text",
        layer,
        text,
        position: applyPoint(matrix, position),
        height,
        rotation,
        multiline: false,
        align,
        baseline,
        widthFactor,
        alpha: stroke.alpha
      });
      return;
    }

    if (type === "MTEXT") {
      const position = pickPoint(entity);
      const text = readEntityText(entity, true);
      if (!position || text.length === 0) return;
      const scaleX = Math.hypot(matrix.a, matrix.b);
      const scaleY = Math.hypot(matrix.c, matrix.d);
      const textScale = Math.max((scaleX + scaleY) / 2, 0.0001);
      const height = Math.max(Number(entity.height ?? entity.textHeight ?? 2.5) * textScale, 0.1);
      const rotation = toRadians(Number(entity.rotation ?? entity.angle ?? 0))
        + Math.atan2(matrix.b, matrix.a);
      const { align, baseline } = textAlignmentFromMTextEntity(entity);
      const widthFactor = Math.max(Math.abs(Number(entity.widthFactor ?? 1)), 0.1);
      pushPrimitive({
        kind: "text",
        layer,
        text,
        position: applyPoint(matrix, position),
        height,
        rotation,
        multiline: true,
        align,
        baseline,
        widthFactor,
        alpha: stroke.alpha
      });
      return;
    }

    if (type === "POINT") {
      const base = asPoint(entity.position) ?? asPoint(entity.point) ?? pickPoint(entity);
      if (!base) return;
      const mode = Math.floor(Number(entity.pdmode ?? entity.pointMode ?? 0));
      const size = Number(entity.pdsize ?? entity.pointSize ?? 0);
      pushPrimitive({
        kind: "point",
        layer,
        position: applyPoint(matrix, base),
        mode: Number.isFinite(mode) ? mode : 0,
        size: Number.isFinite(size) ? size : 0,
        stroke
      });
      return;
    }

    if (type === "INSERT") {
      const blockName = String(entity.name ?? entity.block ?? "").trim();
      if (!blockName) return;
      const block = blocks[blockName];
      if (!block || !Array.isArray(block.entities)) {
        warningSet.add(`INSERT block not found: ${blockName}`);
        return;
      }
      if (blockStack.includes(blockName)) return;

      const insertion = pickPoint(entity) ?? { x: 0, y: 0 };
      const sx = Number(entity.xScale ?? entity.xscale ?? 1);
      const sy = Number(entity.yScale ?? entity.yscale ?? 1);
      const rotation = toRadians(Number(entity.rotation ?? entity.angle ?? 0));
      const columns = Math.max(1, Math.floor(Number(entity.columnCount ?? entity.columns ?? 1)));
      const rows = Math.max(1, Math.floor(Number(entity.rowCount ?? entity.rows ?? 1)));
      const columnSpacing = Number(entity.columnSpacing ?? entity.colSpacing ?? 0);
      const rowSpacing = Number(entity.rowSpacing ?? entity.rowSpace ?? 0);

      const local = multiplyMatrix(
        translationMatrix(insertion.x, insertion.y),
        multiplyMatrix(rotationMatrix(rotation), scaleMatrix(sx, sy))
      );

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const arrayOffset = translationMatrix(column * columnSpacing, row * rowSpacing);
          const next = multiplyMatrix(matrix, multiplyMatrix(local, arrayOffset));
          for (const child of block.entities as Record<string, unknown>[]) {
            expandEntity(child, next, [...blockStack, blockName], depth + 1, stroke);
          }

          const attribs = Array.isArray(entity.attribs)
            ? (entity.attribs as Record<string, unknown>[])
            : [];
          for (const attrib of attribs) {
            expandEntity(attrib, next, blockStack, depth + 1, stroke);
          }
        }
      }
      return;
    }

    if (type === "DIMENSION") {
      const blockName = String(entity.block ?? "").trim();
      if (blockName && blocks[blockName] && Array.isArray(blocks[blockName].entities)) {
        for (const child of blocks[blockName].entities as Record<string, unknown>[]) {
          expandEntity(child, matrix, [...blockStack, blockName], depth + 1, stroke);
        }
      }
      const defA = entity.definitionPoint as Point | undefined;
      const defB = entity.definitionPoint2 as Point | undefined;
      let measurement = 0;
      if (defA && defB) {
        const mappedA = applyPoint(matrix, defA);
        const mappedB = applyPoint(matrix, defB);
        pushPrimitive({
          kind: "line",
          layer,
          start: mappedA,
          end: mappedB,
          stroke
        });

        measurement = Math.hypot(defB.x - defA.x, defB.y - defA.y);
        const viewLen = Math.hypot(mappedB.x - mappedA.x, mappedB.y - mappedA.y);
        if (viewLen > 1e-9) {
          const ux = (mappedB.x - mappedA.x) / viewLen;
          const uy = (mappedB.y - mappedA.y) / viewLen;
          const arrowSize = getLeaderArrowSize(entity, matrix);
          pushPrimitive({
            kind: "arrow",
            layer,
            tip: mappedA,
            tail: { x: mappedA.x + ux * arrowSize, y: mappedA.y + uy * arrowSize },
            size: arrowSize,
            stroke
          });
          pushPrimitive({
            kind: "arrow",
            layer,
            tip: mappedB,
            tail: { x: mappedB.x - ux * arrowSize, y: mappedB.y - uy * arrowSize },
            size: arrowSize,
            stroke
          });
        }
      }

      const dimText = parseDimensionText(entity, measurement);
      if (dimText && dimText.length > 0) {
        const position = pickPoint(entity)
          ?? ((defA && defB) ? { x: (defA.x + defB.x) / 2, y: (defA.y + defB.y) / 2 } : null);
        if (position) {
          const scaleX = Math.hypot(matrix.a, matrix.b);
          const scaleY = Math.hypot(matrix.c, matrix.d);
          const styleHeight = Number(entity.textHeight ?? entity.dimtxt ?? entity.height ?? 2.5);
          const height = Math.max(styleHeight * ((scaleX + scaleY) / 2), 0.1);
          const textAngle = toRadians(
            Number(entity.textRotation ?? entity.rotation ?? entity.angle ?? 0)
          );
          pushPrimitive({
            kind: "text",
            layer,
            text: dimText,
            position: applyPoint(matrix, position),
            height,
            rotation: textAngle + Math.atan2(matrix.b, matrix.a),
            multiline: false,
            align: "center",
            baseline: "middle",
            widthFactor: 1,
            alpha: stroke.alpha
          });
        }
      }
      return;
    }

    if (type.length > 0) {
      unsupportedEntities.add(type);
    }
  };

  for (const entity of entities as Record<string, unknown>[]) {
    expandEntity(entity, identityMatrix(), [], 0);
  }

  const bounds = computeBounds(primitives) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const layers = Array.from(layerCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const layerStroke: Record<string, StrokeStyle> = {};
  for (const layer of layers) {
    layerStroke[layer.name] = resolveStrokeStyle(
      { lineTypeName: "BYLAYER", lineWeight: -1, transparency: Number.NaN },
      layer.name,
      lineTypePatterns,
      layerLineTypes,
      layerLineWeights,
      layerTransparency,
      layerColors,
      globalLineTypeScale
    );
  }

  return {
    primitives,
    bounds,
    layers,
    layerStroke,
    unsupportedEntities: Array.from(unsupportedEntities).sort(),
    renderWarnings: Array.from(warningSet)
  };
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
    const facePrimitives = visiblePrimitives.filter((primitive) => primitive.kind === "face");
    const strokePrimitives = visiblePrimitives.filter((primitive) =>
      !isHatchPrimitive(primitive) && primitive.kind !== "face"
    );

    for (const primitive of hatchPrimitives) {
      ctx.save();
      const color = parsed.layerStroke[primitive.layer]?.color ?? layerColor(primitive.layer);
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
        strokeHatchPattern(ctx, map, visibleBounds, primitive.pattern, scale);
        ctx.restore();
      }
      ctx.restore();
    }

    for (const primitive of facePrimitives) {
      if (primitive.points.length < 3) continue;
      const color = parsed.layerStroke[primitive.layer]?.color ?? layerColor(primitive.layer);
      ctx.beginPath();
      const first = map(primitive.points[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < primitive.points.length; i += 1) {
        const point = map(primitive.points[i]);
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.14;
      ctx.fill("nonzero");
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const primitive of strokePrimitives) {
      ctx.beginPath();
      const layerStroke = parsed.layerStroke[primitive.layer]
        ?? { dash: [], lineWidth: 1.1, alpha: 1, color: aciColor(7) };
      const stroke = "stroke" in primitive ? primitive.stroke : layerStroke;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      const dash = stroke.dash;
      ctx.setLineDash(
        dash.length >= 2 ? dash.map((value) => Math.max(value * scale * 0.45, 1)) : []
      );
      ctx.lineDashOffset = 0;
      ctx.globalAlpha = stroke.alpha;

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

      if (primitive.kind === "arrow") {
        ctx.setLineDash([]);
        const tip = map(primitive.tip);
        const tail = map(primitive.tail);
        const dx = tail.x - tip.x;
        const dy = tail.y - tip.y;
        const len = Math.hypot(dx, dy);
        if (len <= 1e-6) continue;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const sizePx = Math.max(primitive.size * scale, 5);
        const base = { x: tip.x + ux * sizePx, y: tip.y + uy * sizePx };
        const wing = sizePx * 0.45;
        const left = { x: base.x + px * wing, y: base.y + py * wing };
        const right = { x: base.x - px * wing, y: base.y - py * wing };
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.closePath();
        ctx.fillStyle = stroke.color;
        ctx.globalAlpha = stroke.alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
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

      if (primitive.kind === "point") {
        ctx.setLineDash([]);
        const p = map(primitive.position);
        const modelSize = Math.abs(primitive.size) * scale;
        const viewportSize = Math.min(width, height);
        const sizePx = Math.max(
          primitive.size > 0
            ? modelSize
            : primitive.size < 0
            ? (viewportSize * Math.abs(primitive.size)) / 100
            : 6,
          2
        );
        const half = sizePx / 2;
        const mode = Math.abs(primitive.mode);
        const baseMode = mode & 31;
        const drawDot = baseMode === 0;
        const drawNone = baseMode === 1;
        const drawPlus = baseMode === 2 || baseMode === 4;
        const drawCross = baseMode === 3 || baseMode === 4;
        const drawCircle = (mode & 32) === 32;
        const drawSquare = (mode & 64) === 64;

        if (drawPlus) {
          ctx.moveTo(p.x - half, p.y);
          ctx.lineTo(p.x + half, p.y);
          ctx.moveTo(p.x, p.y - half);
          ctx.lineTo(p.x, p.y + half);
        }
        if (drawCross) {
          ctx.moveTo(p.x - half, p.y - half);
          ctx.lineTo(p.x + half, p.y + half);
          ctx.moveTo(p.x - half, p.y + half);
          ctx.lineTo(p.x + half, p.y - half);
        }
        if (drawDot) {
          ctx.fillStyle = stroke.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1.5, half / 2), 0, Math.PI * 2);
          ctx.fill();
        } else if (drawNone && !drawCircle && !drawSquare && !drawPlus && !drawCross) {
          continue;
        }
        if (drawCircle) {
          ctx.moveTo(p.x + half, p.y);
          ctx.arc(p.x, p.y, half, 0, Math.PI * 2);
        }
        if (drawSquare) {
          ctx.rect(p.x - half, p.y - half, sizePx, sizePx);
        }
        ctx.stroke();
        continue;
      }

      if (primitive.kind === "text") {
        ctx.setLineDash([]);
        ctx.globalAlpha = primitive.alpha;
        const p = map(primitive.position);
        const lines = primitive.text.split("\n");
        const fontSize = Math.max(primitive.height * scale, 9);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-primitive.rotation);
        ctx.scale(primitive.widthFactor, 1);
        ctx.fillStyle = stroke.color;
        ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
        ctx.textBaseline = primitive.baseline;
        ctx.textAlign = primitive.align;

        if (primitive.multiline) {
          const lineHeight = fontSize * 1.2;
          const baselineAdjust = primitive.baseline === "top"
            ? lineHeight
            : primitive.baseline === "middle"
            ? lineHeight / 2
            : 0;
          for (let i = 0; i < lines.length; i += 1) {
            ctx.fillText(lines[i], 0, baselineAdjust + i * lineHeight);
          }
        } else {
          ctx.fillText(primitive.text, 0, 0);
        }

        ctx.restore();
        ctx.globalAlpha = 1;
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
                        background: parsed.layerStroke[layer.name]?.color ?? layerColor(layer.name)
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
      {parsed.renderWarnings.length > 0
        ? (
          <p
            style={{
              position: "absolute",
              left: 8,
              bottom: parsed.unsupportedEntities.length > 0 ? 76 : 42,
              color: "var(--text-secondary)",
              fontSize: 12,
              padding: "4px 8px",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--bg-main) 92%, transparent)"
            }}
          >
            Warnings: {parsed.renderWarnings.join(" | ")}
          </p>
        )
        : null}
      {parsed.unsupportedEntities.length > 0
        ? (
          <p
            style={{
              position: "absolute",
              left: 8,
              bottom: 42,
              color: "var(--text-secondary)",
              fontSize: 12,
              padding: "4px 8px",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--bg-main) 92%, transparent)"
            }}
          >
            Unsupported entities: {parsed.unsupportedEntities.join(", ")}
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
