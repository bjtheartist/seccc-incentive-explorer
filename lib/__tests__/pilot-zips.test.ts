import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PILOT_ZIPS, getPilotZipEntry } from "../pilot-zips";
import { CHICAGO_COMMUNITY_AREAS } from "../community-areas";

const EXPECTED_ZIPS = [
  "60617",
  "60619",
  "60649",
  "60624",
  "60623",
  "60644",
  "60651",
  "60621",
  "60636",
];

describe("PILOT_ZIPS", () => {
  it("contains exactly the 9 pilot ZIPs", () => {
    expect(PILOT_ZIPS).toHaveLength(9);
    expect(PILOT_ZIPS.map((entry) => entry.zip).sort()).toEqual([...EXPECTED_ZIPS].sort());
  });

  it("has unique ZIPs", () => {
    const zips = PILOT_ZIPS.map((entry) => entry.zip);
    expect(new Set(zips).size).toBe(zips.length);
  });

  it("has a non-empty primaryNeighborhood for every entry", () => {
    for (const entry of PILOT_ZIPS) {
      expect(entry.primaryNeighborhood.trim().length).toBeGreaterThan(0);
    }
  });

  it("has a secondaryAreas array (possibly empty) for every entry, with no empty-string entries", () => {
    for (const entry of PILOT_ZIPS) {
      expect(Array.isArray(entry.secondaryAreas)).toBe(true);
      for (const area of entry.secondaryAreas) {
        expect(area.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every 5-digit ZIP is well-formed", () => {
    for (const entry of PILOT_ZIPS) {
      expect(entry.zip).toMatch(/^\d{5}$/);
    }
  });

  it("getPilotZipEntry resolves each pilot ZIP and returns undefined for a non-pilot ZIP", () => {
    for (const zip of EXPECTED_ZIPS) {
      expect(getPilotZipEntry(zip)?.zip).toBe(zip);
    }
    expect(getPilotZipEntry("60601")).toBeUndefined();
  });

  it("primaryNeighborhood names are real Chicago community areas (lib/community-areas.ts)", () => {
    const knownNames = new Set(CHICAGO_COMMUNITY_AREAS.map((ca) => ca.name));
    for (const entry of PILOT_ZIPS) {
      expect(knownNames.has(entry.primaryNeighborhood)).toBe(true);
    }
  });

  it("matches the computed ZIP -> community-area inversion of data/exports/community-area-zip.json", () => {
    // Guards against drift: every primaryNeighborhood/secondaryAreas name
    // here should be a community area whose centroid the exported map
    // actually places inside that ZIP (see lib/pilot-zips.ts's derivation
    // note) — not a hand-typed guess that silently goes stale.
    const raw = readFileSync(
      path.join(process.cwd(), "data/exports/community-area-zip.json"),
      "utf8"
    );
    const caZip = JSON.parse(raw) as Record<string, string>;
    const nameById = new Map(CHICAGO_COMMUNITY_AREAS.map((ca) => [ca.id, ca.name]));

    const areasByZip = new Map<string, string[]>();
    for (const [caId, zip] of Object.entries(caZip)) {
      if (caId === "_meta") continue;
      const name = nameById.get(Number(caId));
      if (!name) continue;
      if (!areasByZip.has(zip)) areasByZip.set(zip, []);
      areasByZip.get(zip)!.push(name);
    }

    for (const entry of PILOT_ZIPS) {
      const computedAreas = areasByZip.get(entry.zip) ?? [];
      expect(computedAreas).toContain(entry.primaryNeighborhood);
      for (const secondary of entry.secondaryAreas) {
        // Secondary labels may carry a colloquial parenthetical (e.g.
        // "South Lawndale (Little Village)") — compare on the base name.
        const baseName = secondary.replace(/\s*\(.*\)\s*$/, "");
        expect(computedAreas).toContain(baseName);
      }
    }
  });
});
