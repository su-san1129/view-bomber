function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPosition(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0])
    && isFiniteNumber(value[1]);
}

function coordinateDepth(geometryType: string): number {
  switch (geometryType) {
    case "Point":
      return 0;
    case "MultiPoint":
    case "LineString":
      return 1;
    case "MultiLineString":
    case "Polygon":
      return 2;
    case "MultiPolygon":
      return 3;
    default:
      return -1;
  }
}

function isCoordinateArray(value: unknown, depth: number): boolean {
  if (depth === 0) {
    return isPosition(value);
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((entry) => isCoordinateArray(entry, depth - 1));
}

function isGeometryObject(value: unknown): value is GeoJSON.Geometry {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "GeometryCollection") {
    return Array.isArray(value.geometries)
      && value.geometries.every((entry) => isGeometryObject(entry));
  }

  const depth = coordinateDepth(value.type);
  if (depth < 0) {
    return false;
  }

  return isCoordinateArray(value.coordinates, depth);
}

function isFeatureObject(value: unknown): value is GeoJSON.Feature {
  if (!isRecord(value) || value.type !== "Feature") {
    return false;
  }

  const geometry = value.geometry;
  if (geometry !== null && !isGeometryObject(geometry)) {
    return false;
  }

  const properties = value.properties;
  if (properties !== null && properties !== undefined && !isRecord(properties)) {
    return false;
  }

  return true;
}

export function isGeoJsonObject(value: unknown): value is GeoJSON.GeoJsonObject {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "FeatureCollection") {
    return Array.isArray(value.features)
      && value.features.every((feature) => isFeatureObject(feature));
  }

  if (value.type === "Feature") {
    return isFeatureObject(value);
  }

  return isGeometryObject(value);
}

export function parseGeoJson(content: string):
  | { ok: true; geojson: GeoJSON.GeoJsonObject; }
  | { ok: false; reason: string; }
{
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isGeoJsonObject(parsed)) {
      return { ok: false, reason: "JSON is not GeoJSON." };
    }
    return { ok: true, geojson: parsed };
  } catch {
    return { ok: false, reason: "Failed to parse JSON." };
  }
}
