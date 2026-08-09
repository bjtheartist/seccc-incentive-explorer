#!/usr/bin/env npx tsx
/**
 * Refresh the two official sources behind Chicago zoning history:
 *
 * 1. City Clerk eLMS: legislative activity and final actions.
 * 2. City ArcGIS zoning layer: current published district geometry.
 *
 * The committed artifacts are deterministic. They intentionally omit a
 * wall-clock "checked at" timestamp, so an unchanged source produces no diff.
 * Git provides the reviewed version history; the map snapshot stores separate
 * attribute and geometry fingerprints keyed by the City's stable GLOBALID.
 *
 * No parcel geometry is derived from eLMS titles or attachments.
 * Special-use decisions are outside this feed and remain a ZBA source.
 *
 * Usage:
 *   npm run data:sync:zoning
 *   npm run data:sync:zoning -- --dry-run
 *   npm run data:sync:zoning -- --skip-map
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildZoningLegislationArtifact,
  buildZoningMapSnapshot,
  CHICAGO_ZONING_LAYER_URL,
  diffZoningMapSnapshots,
  fetchElmsZoningLedger,
  normalizeZoningMapFeature,
  type ZoningMapSnapshot,
  type ZoningMapSnapshotRecord,
} from "../lib/zoning-legislation";

const OUTPUT_DIR = path.join(process.cwd(), "data", "curated", "zoning");
const LEGISLATION_PATH = path.join(OUTPUT_DIR, "zoning-legislation.json");
const MAP_SNAPSHOT_PATH = path.join(OUTPUT_DIR, "zoning-map-snapshot.json");
const MAP_DELTA_PATH = path.join(OUTPUT_DIR, "zoning-map-latest-delta.json");
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_RETRIES = 2;

interface ArcGisPage {
  error?: { message?: string };
  features?: unknown[];
  exceededTransferLimit?: boolean;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchZoningMapRecords(): Promise<ZoningMapSnapshotRecord[]> {
  const countUrl = new URL(`${CHICAGO_ZONING_LAYER_URL}/query`);
  countUrl.searchParams.set("where", "1=1");
  countUrl.searchParams.set("returnCountOnly", "true");
  countUrl.searchParams.set("f", "json");
  const countPayload = (await fetchJson(countUrl.toString())) as { count?: unknown };
  const expectedCount = Number(countPayload?.count);
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new Error("ArcGIS zoning layer did not publish a valid feature count");
  }

  const out: ZoningMapSnapshotRecord[] = [];
  const pageSize = 2_000;
  for (let offset = 0; offset < expectedCount; offset += pageSize) {
    const url = new URL(`${CHICAGO_ZONING_LAYER_URL}/query`);
    url.searchParams.set("where", "1=1");
    url.searchParams.set(
      "outFields",
      [
        "GLOBALID",
        "ZONING_ID",
        "ZONE_CLASS",
        "ZONE_TYPE",
        "PD_NUM",
        "PMD_SUB_AREA",
        "ORDINANCE_NUM",
        "ORDINANCE_DATE",
        "CLERK_DOCNO",
        "CLERK_URL",
        "UPDATE_TIMESTAMP",
      ].join(","),
    );
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("geometryPrecision", "6");
    url.searchParams.set("orderByFields", "GLOBALID ASC");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(pageSize));
    url.searchParams.set("f", "json");

    const page = (await fetchJson(url.toString())) as ArcGisPage;
    if (page.error) {
      throw new Error(`ArcGIS zoning query failed: ${page.error.message ?? "unknown error"}`);
    }
    if (!Array.isArray(page.features)) {
      throw new Error("ArcGIS zoning layer returned an invalid feature page");
    }
    for (const feature of page.features) {
      const record = normalizeZoningMapFeature(feature);
      if (!record) {
        throw new Error("ArcGIS zoning layer returned a feature without GLOBALID or geometry");
      }
      out.push(record);
    }
    console.log(`  map: ${Math.min(out.length, expectedCount)}/${expectedCount}`);
  }

  if (out.length !== expectedCount) {
    throw new Error(
      `ArcGIS zoning layer published ${expectedCount} features but returned ${out.length}`,
    );
  }
  if (new Set(out.map((row) => row.globalId)).size !== out.length) {
    throw new Error("ArcGIS zoning layer returned duplicate GLOBALID values");
  }
  return out;
}

async function readSnapshot(): Promise<ZoningMapSnapshot | null> {
  try {
    return JSON.parse(await readFile(MAP_SNAPSHOT_PATH, "utf8")) as ZoningMapSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeIfChanged(filePath: string, payload: unknown): Promise<boolean> {
  const next = `${JSON.stringify(payload, null, 2)}\n`;
  let previous: string | null = null;
  try {
    previous = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous === next) return false;
  await writeFile(filePath, next, "utf8");
  return true;
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const skipMap = hasFlag("--skip-map");
  const skipLegislation = hasFlag("--skip-legislation");
  await mkdir(OUTPUT_DIR, { recursive: true });

  let legislationChanged = false;
  if (!skipLegislation) {
    console.log("Fetching official eLMS zoning matters...");
    const ledger = await fetchElmsZoningLedger();
    const artifact = buildZoningLegislationArtifact(ledger.matters, ledger.searches);
    console.log(
      `  legislation: ${artifact.coverage.total} matters; ` +
        `${artifact.coverage.byLifecycle.pending} pending; ` +
        `${artifact.coverage.byLifecycle.adopted} adopted`,
    );
    if (!dryRun) {
      legislationChanged = await writeIfChanged(LEGISLATION_PATH, artifact);
    }
  }

  let mapChanged = false;
  let mapDeltaChanged = false;
  if (!skipMap) {
    console.log("Fetching official ArcGIS zoning snapshot...");
    const previous = await readSnapshot();
    const current = buildZoningMapSnapshot(await fetchZoningMapRecords());
    const delta = diffZoningMapSnapshots(previous, current);
    console.log(
      `  map: ${current.featureCount} features; ` +
        `${delta.counts.added} added; ${delta.counts.removed} removed; ` +
        `${delta.counts.attributesChanged} attribute changes; ` +
        `${delta.counts.geometryChanged} geometry changes`,
    );
    if (!dryRun) {
      mapChanged = await writeIfChanged(MAP_SNAPSHOT_PATH, current);
      const hasDelta = delta.changes.length > 0;
      if (hasDelta || previous === null) {
        mapDeltaChanged = await writeIfChanged(MAP_DELTA_PATH, delta);
      }
    }
  }

  if (dryRun) {
    console.log("Dry run complete; no files written.");
    return;
  }
  console.log(
    `Refresh complete: legislation=${legislationChanged ? "changed" : "unchanged"}, ` +
      `map=${mapChanged ? "changed" : "unchanged"}, ` +
      `delta=${mapDeltaChanged ? "changed" : "unchanged"}`,
  );
}

main().catch((error) => {
  console.error("Zoning source refresh failed:", error);
  process.exit(1);
});
