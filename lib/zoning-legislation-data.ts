import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  ZoningLegislationArtifact,
  ZoningMapDelta,
  ZoningMapSnapshot,
} from "@/lib/zoning-legislation";

const DATA_DIR = path.join(process.cwd(), "data", "curated", "zoning");
const LEGISLATION_PATH = path.join(DATA_DIR, "zoning-legislation.json");
const MAP_SNAPSHOT_PATH = path.join(DATA_DIR, "zoning-map-snapshot.json");
const MAP_DELTA_PATH = path.join(DATA_DIR, "zoning-map-latest-delta.json");

let cache:
  | {
      legislation: ZoningLegislationArtifact;
      mapSnapshot: ZoningMapSnapshot;
      mapDelta: ZoningMapDelta;
    }
  | undefined;

export function loadZoningSourceLedger() {
  if (cache) return cache;
  const legislation = JSON.parse(
    readFileSync(LEGISLATION_PATH, "utf8"),
  ) as ZoningLegislationArtifact;
  const mapSnapshot = JSON.parse(
    readFileSync(MAP_SNAPSHOT_PATH, "utf8"),
  ) as ZoningMapSnapshot;
  const mapDelta = JSON.parse(readFileSync(MAP_DELTA_PATH, "utf8")) as ZoningMapDelta;

  if (
    legislation.schemaVersion !== 1 ||
    mapSnapshot.schemaVersion !== 1 ||
    mapDelta.schemaVersion !== 1 ||
    !Array.isArray(legislation.matters) ||
    !Array.isArray(mapSnapshot.records) ||
    !Array.isArray(mapDelta.changes)
  ) {
    throw new Error("The committed zoning source ledger is malformed");
  }
  if (mapSnapshot.featureCount !== mapSnapshot.records.length) {
    throw new Error("The zoning map snapshot feature count does not reconcile");
  }

  cache = { legislation, mapSnapshot, mapDelta };
  return cache;
}

export function clearZoningSourceLedgerCacheForTests() {
  cache = undefined;
}
