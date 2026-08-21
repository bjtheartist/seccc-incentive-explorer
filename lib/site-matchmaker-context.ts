export interface SiteMatchmakerContextMetric {
  tractId: string | null;
  population: number | null;
  populationDensityPerSqMi: number | null;
  walkabilityIndex: number | null;
  nearestExpresswayName: string | null;
  nearestExpresswayMiles: number | null;
  midwayMiles: number;
  ohareMiles: number;
}

export interface SiteMatchmakerContextFile {
  version: 1;
  generatedAt: string;
  zip: string;
  sources: {
    population: { label: string; year: string; url: string };
    landArea: { label: string; vintage: string; url: string };
    walkability: { label: string; vintage: string; url: string; method: string };
    transport: { label: string; url: string; method: string };
    airports: { label: string; method: string };
  };
  rows: Record<string, SiteMatchmakerContextMetric>;
}

export interface SiteMatchmakerContextKeyInput {
  pin?: string | null;
  address?: string | null;
  lat?: number | string | null;
  lon?: number | string | null;
}

export interface TractAttribute {
  tractId: string;
  population: number | null;
  areaLandSqMeters: number | null;
}

export interface EpaWalkabilityBlockGroup {
  GEOID20: string;
  NatWalkInd: number | null;
  TotPop: number | null;
}

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown>;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
  metadata?: Record<string, unknown>;
}

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export type Position = [number, number] | [number, number, number];

interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface TractIndexEntry {
  tractId: string;
  bbox: BBox;
  polygons: Position[][][];
}

export interface ExpresswaySegment {
  name: string;
  start: [number, number];
  end: [number, number];
  bbox: BBox;
}

export interface ExpresswaySpatialIndex {
  segments: ExpresswaySegment[];
  cellSizeDegrees: number;
  cells: Map<string, number[]>;
  minCellX: number;
  maxCellX: number;
  minCellY: number;
  maxCellY: number;
}

export interface NearestExpresswayResult {
  name: string | null;
  miles: number | null;
}

const SQUARE_METERS_PER_SQUARE_MILE = 2_589_988.110336;
const EARTH_RADIUS_MILES = 3_958.7613;
const MIDWAY: [number, number] = [-87.7522, 41.7868];
const OHARE: [number, number] = [-87.9048, 41.9786];
const DEFAULT_EXPRESSWAY_CELL_SIZE_DEGREES = 0.02;

export function normalizeSiteMatchmakerPin(pin: string | null | undefined): string | null {
  if (pin == null) return null;
  const digits = String(pin).replace(/\D/g, "");
  return digits.length === 14 ? digits : null;
}

export function normalizeSiteMatchmakerAddress(address: string | null | undefined): string {
  return (address ?? "")
    .toUpperCase()
    .replace(/[^\dA-Z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function siteMatchmakerContextKey(input: SiteMatchmakerContextKeyInput): string {
  const pin = normalizeSiteMatchmakerPin(input.pin);
  if (pin) return `pin:${pin}`;

  const lat = parseFiniteNumber(input.lat);
  const lon = parseFiniteNumber(input.lon);
  const coordinatePart = lat != null && lon != null ? `${lat.toFixed(6)},${lon.toFixed(6)}` : "unknown";
  const addressPart = normalizeSiteMatchmakerAddress(input.address) || "UNKNOWN";
  return `coord:${coordinatePart}|addr:${addressPart}`;
}

export function populationDensityPerSqMi(
  population: number | null | undefined,
  areaLandSqMeters: number | null | undefined,
): number | null {
  if (population == null || areaLandSqMeters == null) return null;
  if (
    !Number.isFinite(population) ||
    population < 0 ||
    !Number.isFinite(areaLandSqMeters) ||
    areaLandSqMeters <= 0
  ) {
    return null;
  }
  return Math.round(population / (areaLandSqMeters / SQUARE_METERS_PER_SQUARE_MILE));
}

export function aggregateEpaWalkabilityToTract(
  blockGroups: readonly EpaWalkabilityBlockGroup[],
): Map<string, number> {
  const byTract = new Map<
    string,
    { weighted: number; population: number; scoreSum: number; scoreCount: number }
  >();

  for (const blockGroup of blockGroups) {
    if (!/^\d{12}$/.test(blockGroup.GEOID20)) continue;
    if (
      blockGroup.NatWalkInd == null ||
      !Number.isFinite(blockGroup.NatWalkInd) ||
      blockGroup.NatWalkInd < 1 ||
      blockGroup.NatWalkInd > 20
    ) {
      continue;
    }
    const tractId = blockGroup.GEOID20.slice(0, 11);
    const current = byTract.get(tractId) ?? {
      weighted: 0,
      population: 0,
      scoreSum: 0,
      scoreCount: 0,
    };
    current.scoreSum += blockGroup.NatWalkInd;
    current.scoreCount += 1;
    if (
      blockGroup.TotPop != null &&
      Number.isFinite(blockGroup.TotPop) &&
      blockGroup.TotPop > 0
    ) {
      current.weighted += blockGroup.NatWalkInd * blockGroup.TotPop;
      current.population += blockGroup.TotPop;
    }
    byTract.set(tractId, current);
  }

  const result = new Map<string, number>();
  for (const [tractId, aggregate] of byTract) {
    const score =
      aggregate.population > 0
        ? aggregate.weighted / aggregate.population
        : aggregate.scoreSum / aggregate.scoreCount;
    result.set(tractId, roundToOneDecimal(score));
  }
  return result;
}

export function buildTractIndex(collection: GeoJsonFeatureCollection): TractIndexEntry[] {
  const entries: TractIndexEntry[] = [];

  for (const feature of collection.features) {
    const tractId = String(feature.properties.tractId ?? feature.properties.GEOID ?? "");
    if (!tractId || !feature.geometry) continue;
    const polygons = geometryToPolygons(feature.geometry);
    if (polygons.length === 0) continue;
    const bbox = bboxForPolygons(polygons);
    if (!bbox) continue;
    entries.push({ tractId, bbox, polygons });
  }

  return entries.sort((a, b) => a.tractId.localeCompare(b.tractId));
}

export function findContainingTract(
  index: readonly TractIndexEntry[],
  lat: number,
  lon: number,
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const entry of index) {
    if (!pointInBBox(lat, lon, entry.bbox)) continue;
    if (entry.polygons.some((polygon) => pointInPolygonWithBoundary(lat, lon, polygon))) {
      return entry.tractId;
    }
  }
  return null;
}

export function buildExpresswaySegments(collection: GeoJsonFeatureCollection): ExpresswaySegment[] {
  const segments: ExpresswaySegment[] = [];

  for (const feature of collection.features) {
    if (feature.properties.kind !== "expressway" || !feature.geometry) continue;
    const name = String(feature.properties.name ?? "").trim();
    if (!name) continue;
    const lines = geometryToLines(feature.geometry);
    for (const line of lines) {
      for (let i = 1; i < line.length; i += 1) {
        const start = lonLat(line[i - 1]);
        const end = lonLat(line[i]);
        if (!start || !end || samePoint(start, end)) continue;
        segments.push({ name, start, end, bbox: bboxForLine([start, end]) });
      }
    }
  }

  return segments;
}

export function buildExpresswaySpatialIndex(
  collection: GeoJsonFeatureCollection,
  cellSizeDegrees = DEFAULT_EXPRESSWAY_CELL_SIZE_DEGREES,
): ExpresswaySpatialIndex {
  if (!Number.isFinite(cellSizeDegrees) || cellSizeDegrees <= 0) {
    throw new Error("Expressway index cell size must be positive");
  }

  const segments = buildExpresswaySegments(collection);
  const cells = new Map<string, number[]>();
  let minCellX = Infinity;
  let maxCellX = -Infinity;
  let minCellY = Infinity;
  let maxCellY = -Infinity;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const startX = gridCellX(segment.bbox.minLon, cellSizeDegrees);
    const endX = gridCellX(segment.bbox.maxLon, cellSizeDegrees);
    const startY = gridCellY(segment.bbox.minLat, cellSizeDegrees);
    const endY = gridCellY(segment.bbox.maxLat, cellSizeDegrees);

    minCellX = Math.min(minCellX, startX);
    maxCellX = Math.max(maxCellX, endX);
    minCellY = Math.min(minCellY, startY);
    maxCellY = Math.max(maxCellY, endY);

    for (let cellX = startX; cellX <= endX; cellX += 1) {
      for (let cellY = startY; cellY <= endY; cellY += 1) {
        const key = gridCellKey(cellX, cellY);
        const indexes = cells.get(key) ?? [];
        indexes.push(segmentIndex);
        cells.set(key, indexes);
      }
    }
  }

  return {
    segments,
    cellSizeDegrees,
    cells,
    minCellX: Number.isFinite(minCellX) ? minCellX : 0,
    maxCellX: Number.isFinite(maxCellX) ? maxCellX : -1,
    minCellY: Number.isFinite(minCellY) ? minCellY : 0,
    maxCellY: Number.isFinite(maxCellY) ? maxCellY : -1,
  };
}

/**
 * Expressway lookup uses a cheap local equirectangular projection to find the
 * nearest segment candidate, then reports the geodesic distance from the input
 * point to the closest point on that candidate. This is straight-line access,
 * not routed travel time.
 */
export function nearestExpressway(
  source: readonly ExpresswaySegment[] | ExpresswaySpatialIndex,
  lat: number,
  lon: number,
): NearestExpresswayResult {
  let spatialIndex: ExpresswaySpatialIndex | null;
  let segments: readonly ExpresswaySegment[];
  if (isExpresswaySpatialIndex(source)) {
    spatialIndex = source;
    segments = source.segments;
  } else {
    spatialIndex = null;
    segments = source;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || segments.length === 0) {
    return { name: null, miles: null };
  }

  let best: { name: string; projectedPoint: [number, number]; planarMiles: number } | null = null;
  const candidateIndexes = spatialIndex === null
    ? segments.map((_, index) => index)
    : expresswayCandidateIndexes(spatialIndex, lat, lon);

  for (const segmentIndex of candidateIndexes) {
    const segment = segments[segmentIndex];
    const candidate = nearestPointOnSegmentPlanar([lon, lat], segment.start, segment.end);
    if (!best || candidate.planarMiles < best.planarMiles) {
      best = { name: segment.name, projectedPoint: candidate.point, planarMiles: candidate.planarMiles };
    }
  }

  if (!best) return { name: null, miles: null };
  return {
    name: best.name,
    miles: roundToTwoDecimals(haversineMiles(lat, lon, best.projectedPoint[1], best.projectedPoint[0])),
  };
}

function isExpresswaySpatialIndex(
  source: readonly ExpresswaySegment[] | ExpresswaySpatialIndex,
): source is ExpresswaySpatialIndex {
  return !Array.isArray(source);
}

function expresswayCandidateIndexes(
  index: ExpresswaySpatialIndex,
  lat: number,
  lon: number,
): number[] {
  const originX = gridCellX(lon, index.cellSizeDegrees);
  const originY = gridCellY(lat, index.cellSizeDegrees);
  const seen = new Set<number>();
  let bestPlanarMiles = Infinity;
  const maxRadius = Math.max(
    Math.abs(originX - index.minCellX),
    Math.abs(originX - index.maxCellX),
    Math.abs(originY - index.minCellY),
    Math.abs(originY - index.maxCellY),
  );

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    forEachGridRingCell(originX, originY, radius, (cellX, cellY) => {
      for (const segmentIndex of index.cells.get(gridCellKey(cellX, cellY)) ?? []) {
        if (seen.has(segmentIndex)) continue;
        seen.add(segmentIndex);
        const segment = index.segments[segmentIndex];
        const candidate = nearestPointOnSegmentPlanar([lon, lat], segment.start, segment.end);
        bestPlanarMiles = Math.min(bestPlanarMiles, candidate.planarMiles);
      }
    });

    if (seen.size === index.segments.length) break;
    if (
      seen.size > 0 &&
      bestPlanarMiles <= distanceToGridSearchBoundaryMiles(
        originX,
        originY,
        radius,
        index.cellSizeDegrees,
        lat,
        lon,
      )
    ) {
      break;
    }
  }

  return [...seen];
}

function forEachGridRingCell(
  originX: number,
  originY: number,
  radius: number,
  visit: (cellX: number, cellY: number) => void,
): void {
  if (radius === 0) {
    visit(originX, originY);
    return;
  }

  const minX = originX - radius;
  const maxX = originX + radius;
  const minY = originY - radius;
  const maxY = originY + radius;
  for (let cellX = minX; cellX <= maxX; cellX += 1) {
    visit(cellX, minY);
    visit(cellX, maxY);
  }
  for (let cellY = minY + 1; cellY < maxY; cellY += 1) {
    visit(minX, cellY);
    visit(maxX, cellY);
  }
}

function distanceToGridSearchBoundaryMiles(
  originX: number,
  originY: number,
  radius: number,
  cellSizeDegrees: number,
  lat: number,
  lon: number,
): number {
  const minLon = (originX - radius) * cellSizeDegrees - 180;
  const maxLon = (originX + radius + 1) * cellSizeDegrees - 180;
  const minLat = (originY - radius) * cellSizeDegrees - 90;
  const maxLat = (originY + radius + 1) * cellSizeDegrees - 90;
  const milesPerDegreeLon = Math.cos((lat * Math.PI) / 180) * 69;
  return Math.min(
    Math.max(0, lon - minLon) * milesPerDegreeLon,
    Math.max(0, maxLon - lon) * milesPerDegreeLon,
    Math.max(0, lat - minLat) * 69,
    Math.max(0, maxLat - lat) * 69,
  );
}

function gridCellX(lon: number, cellSizeDegrees: number): number {
  return Math.floor((lon + 180) / cellSizeDegrees);
}

function gridCellY(lat: number, cellSizeDegrees: number): number {
  return Math.floor((lat + 90) / cellSizeDegrees);
}

function gridCellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

export function airportDistances(lat: number, lon: number): { midwayMiles: number; ohareMiles: number } {
  return {
    midwayMiles: roundToTwoDecimals(haversineMiles(lat, lon, MIDWAY[1], MIDWAY[0])),
    ohareMiles: roundToTwoDecimals(haversineMiles(lat, lon, OHARE[1], OHARE[0])),
  };
}

function parseFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function geometryToPolygons(geometry: GeoJsonGeometry): Position[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function geometryToLines(geometry: GeoJsonGeometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function bboxForPolygons(polygons: Position[][][]): BBox | null {
  const points = polygons.flat(2);
  return bboxForPositions(points);
}

function bboxForLine(line: [number, number][]): BBox {
  return bboxForPositions(line) ?? { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
}

function bboxForPositions(positions: readonly Position[] | readonly [number, number][]): BBox | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const position of positions) {
    const point = lonLat(position);
    if (!point) continue;
    minLon = Math.min(minLon, point[0]);
    minLat = Math.min(minLat, point[1]);
    maxLon = Math.max(maxLon, point[0]);
    maxLat = Math.max(maxLat, point[1]);
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function lonLat(position: readonly number[]): [number, number] | null {
  const lon = position[0];
  const lat = position[1];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function pointInBBox(lat: number, lon: number, bbox: BBox): boolean {
  return lon >= bbox.minLon && lon <= bbox.maxLon && lat >= bbox.minLat && lat <= bbox.maxLat;
}

function pointInPolygonWithBoundary(lat: number, lon: number, polygon: Position[][]): boolean {
  const outer = polygon[0];
  if (!outer || !pointInRingWithBoundary(lat, lon, outer)) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRingWithBoundary(lat, lon, polygon[i])) return false;
  }
  return true;
}

function pointInRingWithBoundary(lat: number, lon: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = lonLat(ring[i]);
    const b = lonLat(ring[j]);
    if (!a || !b) continue;
    if (pointOnSegment(lon, lat, a[0], a[1], b[0], b[1])) return true;
    const intersects = a[1] > lat !== b[1] > lat && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < -1e-10) return false;
  const lengthSq = (bx - ax) ** 2 + (by - ay) ** 2;
  return dot <= lengthSq + 1e-10;
}

function nearestPointOnSegmentPlanar(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): { point: [number, number]; planarMiles: number } {
  const referenceLat = point[1];
  const p = projectToMiles(point, referenceLat);
  const a = projectToMiles(start, referenceLat);
  const b = projectToMiles(end, referenceLat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
  const projected = { x: a.x + t * dx, y: a.y + t * dy };
  const projectedLonLat: [number, number] = [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
  return {
    point: projectedLonLat,
    planarMiles: Math.hypot(p.x - projected.x, p.y - projected.y),
  };
}

function projectToMiles(point: [number, number], referenceLat: number): { x: number; y: number } {
  const milesPerDegreeLat = 69.0;
  const milesPerDegreeLon = Math.cos((referenceLat * Math.PI) / 180) * milesPerDegreeLat;
  return { x: point[0] * milesPerDegreeLon, y: point[1] * milesPerDegreeLat };
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
