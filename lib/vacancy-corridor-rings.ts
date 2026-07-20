import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VacancyReportMapCorridor } from "@/components/vacancy/VacancyReportMap";

/**
 * Server-side corridor-outline loader: the export edition carries lean
 * {name, kind} corridor refs; this attaches the actual polygon rings from the
 * committed zone geojsons so the map can draw dashed outlines + labels.
 * Files are read once per process (module memo) — they are static assets.
 */

type CorridorKind = "ssa" | "commercial" | "industrial";

const KIND_FILES: Record<CorridorKind, string> = {
  ssa: "special-service-areas.geojson",
  commercial: "ccsa-corridors.geojson",
  industrial: "industrial-corridors.geojson",
};

type RingsByName = Map<string, [number, number][][]>;
const memo = new Map<CorridorKind, RingsByName>();

function ringsForKind(kind: CorridorKind): RingsByName {
  const cached = memo.get(kind);
  if (cached) return cached;
  const byName: RingsByName = new Map();
  const path = join(process.cwd(), "public", "data", "zones", KIND_FILES[kind]);
  if (existsSync(path)) {
    try {
      const collection = JSON.parse(readFileSync(path, "utf8")) as {
        features?: {
          properties?: { name?: string };
          geometry?: { type?: string; coordinates?: unknown };
        }[];
      };
      for (const feature of collection.features ?? []) {
        const name = feature.properties?.name;
        const geometry = feature.geometry;
        if (!name || !geometry?.coordinates) continue;
        // Outer ring(s) only — Polygon ring [0], each MultiPolygon polygon's ring [0].
        const rings: [number, number][][] =
          geometry.type === "Polygon"
            ? [(geometry.coordinates as [number, number][][])[0]]
            : geometry.type === "MultiPolygon"
              ? (geometry.coordinates as [number, number][][][]).map((poly) => poly[0])
              : [];
        if (rings.length > 0) byName.set(name.toLowerCase(), rings);
      }
    } catch {
      // Corrupt/missing file -> no outlines; the lean refs still render.
    }
  }
  memo.set(kind, byName);
  return byName;
}

export function loadCorridorRings(
  corridors: { name: string; kind: CorridorKind }[] | null | undefined,
): VacancyReportMapCorridor[] | null {
  if (!corridors || corridors.length === 0) return null;
  return corridors.map((corridor) => ({
    ...corridor,
    rings: ringsForKind(corridor.kind).get(corridor.name.toLowerCase()) ?? null,
  }));
}
