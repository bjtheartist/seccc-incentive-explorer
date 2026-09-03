import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  ZoningLegislationArtifact,
  ZoningMapDelta,
  ZoningMapSnapshot,
} from "@/lib/zoning-legislation";
import type { ChicagoZbaDelta, ChicagoZbaSnapshot } from "@/lib/chicago-zba";

const DATA_DIR = path.join(process.cwd(), "data", "curated", "zoning");
const LEGISLATION_PATH = path.join(DATA_DIR, "zoning-legislation.json");
const MAP_SNAPSHOT_PATH = path.join(DATA_DIR, "zoning-map-snapshot.json");
const MAP_DELTA_PATH = path.join(DATA_DIR, "zoning-map-latest-delta.json");
const ZBA_SNAPSHOT_PATH = path.join(DATA_DIR, "zoning-zba-snapshot.json");
const ZBA_DELTA_PATH = path.join(DATA_DIR, "zoning-zba-latest-delta.json");

let cache:
  | {
      legislation: ZoningLegislationArtifact;
      mapSnapshot: ZoningMapSnapshot;
      mapDelta: ZoningMapDelta;
      zbaSnapshot: ChicagoZbaSnapshot;
      zbaDelta: ChicagoZbaDelta;
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
  // `counts.rekeyed` postdates the artifacts already committed: deltas
  // written before the 2026-09-02 GLOBALID rotation was understood have no
  // such field. Default it to 0 on read rather than letting `undefined`
  // reach the admin page as "NaN rekeyed" — the next scheduled refresh
  // regenerates the file with the field present.
  const rawMapDelta = JSON.parse(readFileSync(MAP_DELTA_PATH, "utf8")) as Omit<
    ZoningMapDelta,
    "counts"
  > & { counts: Partial<ZoningMapDelta["counts"]> };
  const mapDelta: ZoningMapDelta = {
    ...rawMapDelta,
    counts: {
      added: 0,
      removed: 0,
      attributesChanged: 0,
      geometryChanged: 0,
      rekeyed: 0,
      ...rawMapDelta.counts,
    },
  };
  const zbaSnapshot = JSON.parse(
    readFileSync(ZBA_SNAPSHOT_PATH, "utf8"),
  ) as ChicagoZbaSnapshot;
  const zbaDelta = JSON.parse(readFileSync(ZBA_DELTA_PATH, "utf8")) as ChicagoZbaDelta;

  if (
    legislation.schemaVersion !== 1 ||
    mapSnapshot.schemaVersion !== 1 ||
    mapDelta.schemaVersion !== 1 ||
    zbaSnapshot.schemaVersion !== 1 ||
    zbaDelta.schemaVersion !== 1 ||
    !Array.isArray(legislation.matters) ||
    !Array.isArray(mapSnapshot.records) ||
    !Array.isArray(mapDelta.changes) ||
    !Array.isArray(zbaSnapshot.records) ||
    !Array.isArray(zbaDelta.changes) ||
    !zbaSnapshot.coverage ||
    !zbaSnapshot.coverage.byCaseType
  ) {
    throw new Error("The committed zoning source ledger is malformed");
  }
  if (mapSnapshot.featureCount !== mapSnapshot.records.length) {
    throw new Error("The zoning map snapshot feature count does not reconcile");
  }
  if (zbaSnapshot.featureCount !== zbaSnapshot.records.length) {
    throw new Error("The ZBA snapshot feature count does not reconcile");
  }

  cache = { legislation, mapSnapshot, mapDelta, zbaSnapshot, zbaDelta };
  return cache;
}

export function clearZoningSourceLedgerCacheForTests() {
  cache = undefined;
}
