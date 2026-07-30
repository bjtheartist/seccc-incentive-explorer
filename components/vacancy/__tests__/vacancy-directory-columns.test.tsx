/**
 * All Properties directory — the two ownership columns.
 *
 *   col 1  PUBLIC / PRIVATE  (sector: government/city-inventory vs
 *                             individual/entity/trust vs "Not yet classified")
 *   col 2  ENTITY            (structure detail: IND / ENT / TRUST / GOV / UNR)
 *
 * Covers the sector derivation EXHAUSTIVELY over the owner-type × structure
 * matrix as a literal expectation table (a spec, not a re-implementation of the
 * classifier), the unresolved/UNK path, the filter semantics, and the
 * never-blank / never-named display guarantees. Also derives sectors over the
 * two real committed per-ZIP directory files so a shipped row can never fall
 * outside the three honest buckets.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  OWNER_SECTOR_ABBREV,
  OWNER_SECTOR_COLORS,
  OWNER_SECTOR_LABELS,
  OWNER_SECTOR_ORDER,
  classifyOwnerSector,
  presentOwnerSectorsInOrder,
  type OwnerSector,
} from "@/lib/owner-sector";
import { OWNER_STRUCTURE_ORDER, type OwnerStructure } from "@/lib/owner-taxonomy";
import { OWNER_TYPE_ORDER, type OwnerType } from "@/lib/owner-classify";
import type { VacancyDirectoryFile, VacancyDirectoryRow } from "@/lib/vacancy-index";
import {
  FLAG_VALUES,
  PROPERTY_TYPES,
  filterAndSortRows,
  rowFlags,
  rowMatchesFilters,
  rowSector,
  rowStructure,
  type DirectoryFilters,
} from "../vacancy-directory-filter";
import VacancyDirectory from "../VacancyDirectory";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function row(over: Partial<VacancyDirectoryRow> = {}): VacancyDirectoryRow {
  return {
    address: "4200 W MADISON ST",
    ownerType: "unknown",
    propertyType: "vacant_building",
    clusterId: null,
    saleYear: null,
    violation: false,
    pin: null,
    ownerStructure: "unresolved",
    ownerGeography: "unknown",
    ...over,
  };
}

const NO_FILTERS: DirectoryFilters = {
  areaId: null,
  sectors: new Set(),
  structures: new Set(),
  types: new Set(),
  flags: new Set(),
  search: "",
};

function filters(over: Partial<DirectoryFilters> = {}): DirectoryFilters {
  return { ...NO_FILTERS, ...over };
}

// ── Sector derivation: exhaustive over owner types × structures ──────────────

/**
 * The full 5 × 5 expectation table, written out rather than computed:
 *
 *   • a `government` structure is Public on every owner type;
 *   • a `city_public` owner type (the City-Owned Land inventory signal) is
 *     Public on every structure, INCLUDING rows whose tax-bill name reads as an
 *     individual or an entity — source of record beats the name heuristic;
 *   • individual / entity / trust are Private;
 *   • a legacy owner type that resolved privately still yields Private even when
 *     the structure axis is unresolved;
 *   • only "nothing resolved on either axis" is Not yet classified.
 */
const SECTOR_MATRIX: Record<OwnerStructure, Record<OwnerType, OwnerSector>> = {
  entity: {
    corporate_llc: "private",
    out_of_state: "private",
    local_private: "private",
    city_public: "public",
    unknown: "private",
  },
  individual: {
    corporate_llc: "private",
    out_of_state: "private",
    local_private: "private",
    city_public: "public",
    unknown: "private",
  },
  trust: {
    corporate_llc: "private",
    out_of_state: "private",
    local_private: "private",
    city_public: "public",
    unknown: "private",
  },
  government: {
    corporate_llc: "public",
    out_of_state: "public",
    local_private: "public",
    city_public: "public",
    unknown: "public",
  },
  unresolved: {
    corporate_llc: "private",
    out_of_state: "private",
    local_private: "private",
    city_public: "public",
    unknown: "unclassified",
  },
};

describe("sector derivation — exhaustive over owner types × structures", () => {
  it("covers every committed structure and owner type (no gaps in the matrix)", () => {
    expect(Object.keys(SECTOR_MATRIX).sort()).toEqual([...OWNER_STRUCTURE_ORDER].sort());
    for (const structure of OWNER_STRUCTURE_ORDER) {
      expect(Object.keys(SECTOR_MATRIX[structure]).sort()).toEqual([...OWNER_TYPE_ORDER].sort());
    }
  });

  for (const structure of OWNER_STRUCTURE_ORDER) {
    for (const ownerType of OWNER_TYPE_ORDER) {
      const expected = SECTOR_MATRIX[structure][ownerType];
      it(`${structure} + ${ownerType} -> ${expected}`, () => {
        expect(classifyOwnerSector({ ownerStructure: structure, ownerType })).toBe(expected);
        expect(rowSector(row({ ownerStructure: structure, ownerType }))).toBe(expected);
      });
    }
  }

  it("never invents a bucket outside the three honest ones", () => {
    for (const structure of OWNER_STRUCTURE_ORDER) {
      for (const ownerType of OWNER_TYPE_ORDER) {
        expect(OWNER_SECTOR_ORDER).toContain(classifyOwnerSector({ ownerStructure: structure, ownerType }));
      }
    }
  });

  it("keeps the ENTITY column on the structure axis, independent of sector", () => {
    // A city-inventory parcel reads Public in col 1 while col 2 still reports
    // what the taxpayer name actually resolved to — the two axes stay distinct.
    const r = row({ ownerType: "city_public", ownerStructure: "entity" });
    expect(rowSector(r)).toBe("public");
    expect(rowStructure(r)).toBe("entity");
  });
});

// ── UNK / unresolved handling ────────────────────────────────────────────────

describe("unresolved handling — honest, never guessed, never blank", () => {
  it('reports "Not yet classified" when neither axis resolved', () => {
    const sector = rowSector(row({ ownerType: "unknown", ownerStructure: "unresolved" }));
    expect(sector).toBe("unclassified");
    expect(OWNER_SECTOR_LABELS[sector]).toBe("Not yet classified");
  });

  it("degrades missing fields to unclassified rather than guessing a bucket", () => {
    expect(classifyOwnerSector({})).toBe("unclassified");
    expect(classifyOwnerSector({ ownerStructure: null, ownerType: null })).toBe("unclassified");
    expect(classifyOwnerSector({ ownerStructure: undefined, ownerType: undefined })).toBe(
      "unclassified",
    );
  });

  it("degrades stale/unrecognized persisted values to unclassified", () => {
    // A value from an older export that no longer exists in either vocabulary.
    expect(classifyOwnerSector({ ownerStructure: "corporation", ownerType: "investor" })).toBe(
      "unclassified",
    );
    expect(rowStructure(row({ ownerStructure: "corporation" as OwnerStructure }))).toBe("unresolved");
  });

  it("still resolves when only ONE axis is present", () => {
    expect(classifyOwnerSector({ ownerStructure: "government" })).toBe("public");
    expect(classifyOwnerSector({ ownerType: "city_public" })).toBe("public");
    expect(classifyOwnerSector({ ownerStructure: "individual" })).toBe("private");
    expect(classifyOwnerSector({ ownerType: "corporate_llc" })).toBe("private");
  });

  it("gives every sector a non-empty label, abbreviation and color", () => {
    for (const sector of OWNER_SECTOR_ORDER) {
      expect(OWNER_SECTOR_LABELS[sector].trim().length).toBeGreaterThan(0);
      expect(OWNER_SECTOR_ABBREV[sector].trim().length).toBeGreaterThan(0);
      expect(OWNER_SECTOR_COLORS[sector]).toMatch(/^#[0-9A-F]{6}$/i);
    }
    // The unresolved cell is a stated value, not an em dash or a blank.
    expect(OWNER_SECTOR_ABBREV.unclassified).toBe("NOT CLASSIFIED");
  });

  it("lists only the sectors actually present, in canonical order", () => {
    expect(presentOwnerSectorsInOrder([])).toEqual([]);
    expect(presentOwnerSectorsInOrder(["unclassified", "public"])).toEqual([
      "public",
      "unclassified",
    ]);
    expect(OWNER_SECTOR_ORDER).toEqual(["public", "private", "unclassified"]);
  });
});

// ── Filter behavior ──────────────────────────────────────────────────────────

describe("column multifilters — empty = no filter, OR within, AND across", () => {
  const cityLand = row({
    address: "100 N KEDZIE AVE",
    ownerType: "city_public",
    ownerStructure: "government",
    propertyType: "vacant_land",
    clusterId: 4,
  });
  const llcBuilding = row({
    address: "200 N KEDZIE AVE",
    ownerType: "unknown",
    ownerStructure: "entity",
    propertyType: "vacant_building",
    saleYear: 2015,
  });
  const personBuilding = row({
    address: "300 N KEDZIE AVE",
    ownerType: "unknown",
    ownerStructure: "individual",
    propertyType: "vacant_building",
    violation: true,
  });
  const unresolvedBuilding = row({
    address: "400 N PULASKI RD",
    ownerType: "unknown",
    ownerStructure: "unresolved",
    propertyType: "vacant_building",
  });
  const all = [cityLand, llcBuilding, personBuilding, unresolvedBuilding];

  it("passes every row when no column has a selection", () => {
    expect(filterAndSortRows(all, NO_FILTERS, "asc")).toHaveLength(all.length);
    for (const r of all) expect(rowMatchesFilters(r, NO_FILTERS)).toBe(true);
  });

  it("an empty sector selection is NO filter, never match-nothing", () => {
    expect(filterAndSortRows(all, filters({ sectors: new Set() }), "asc")).toHaveLength(4);
  });

  it("filters the first column by sector", () => {
    const publicOnly = filterAndSortRows(all, filters({ sectors: new Set(["public"]) }), "asc");
    expect(publicOnly.map((r) => r.address)).toEqual(["100 N KEDZIE AVE"]);

    const privateOnly = filterAndSortRows(all, filters({ sectors: new Set(["private"]) }), "asc");
    expect(privateOnly.map((r) => r.address)).toEqual(["200 N KEDZIE AVE", "300 N KEDZIE AVE"]);

    const unclassified = filterAndSortRows(
      all,
      filters({ sectors: new Set(["unclassified"]) }),
      "asc",
    );
    expect(unclassified.map((r) => r.address)).toEqual(["400 N PULASKI RD"]);
  });

  it("ORs within the sector column", () => {
    const both = filterAndSortRows(all, filters({ sectors: new Set(["public", "unclassified"]) }), "asc");
    expect(both.map((r) => r.address)).toEqual(["100 N KEDZIE AVE", "400 N PULASKI RD"]);
  });

  it("filters the second column by entity/structure, independently of sector", () => {
    const entities = filterAndSortRows(all, filters({ structures: new Set(["entity"]) }), "asc");
    expect(entities.map((r) => r.address)).toEqual(["200 N KEDZIE AVE"]);

    const gov = filterAndSortRows(all, filters({ structures: new Set(["government"]) }), "asc");
    expect(gov.map((r) => r.address)).toEqual(["100 N KEDZIE AVE"]);
  });

  it("ANDs across the sector and entity columns", () => {
    // Private + government is an empty intersection by construction.
    expect(
      filterAndSortRows(
        all,
        filters({ sectors: new Set(["private"]), structures: new Set(["government"]) }),
        "asc",
      ),
    ).toHaveLength(0);

    expect(
      filterAndSortRows(
        all,
        filters({ sectors: new Set(["private"]), structures: new Set(["individual"]) }),
        "asc",
      ).map((r) => r.address),
    ).toEqual(["300 N KEDZIE AVE"]);
  });

  it("ANDs the ownership columns with TYPE and FLAGS (both unchanged)", () => {
    expect(
      filterAndSortRows(
        all,
        filters({ sectors: new Set(["public"]), types: new Set(["vacant_building"]) }),
        "asc",
      ),
    ).toHaveLength(0);

    expect(
      filterAndSortRows(
        all,
        filters({ sectors: new Set(["private"]), flags: new Set(["tax_sale"]) }),
        "asc",
      ).map((r) => r.address),
    ).toEqual(["200 N KEDZIE AVE"]);

    expect(
      filterAndSortRows(all, filters({ flags: new Set(["none"]) }), "asc").map((r) => r.address),
    ).toEqual(["100 N KEDZIE AVE", "400 N PULASKI RD"]);
  });

  it("keeps the address search and area handoff working alongside the new column", () => {
    expect(
      filterAndSortRows(all, filters({ search: "kedzie" }), "asc").map((r) => r.address),
    ).toHaveLength(3);
    expect(
      filterAndSortRows(
        all,
        filters({ areaId: 4, sectors: new Set(["public"]) }),
        "asc",
      ).map((r) => r.address),
    ).toEqual(["100 N KEDZIE AVE"]);
    // An area filter never matches rows that never mapped into a kept cluster.
    expect(filterAndSortRows(all, filters({ areaId: 4 }), "asc")).toHaveLength(1);
  });

  it("sorts by address in both directions without mutating the input", () => {
    const input = [...all];
    const desc = filterAndSortRows(input, NO_FILTERS, "desc");
    expect(desc[0].address).toBe("400 N PULASKI RD");
    expect(input.map((r) => r.address)).toEqual(all.map((r) => r.address));
  });

  it("keeps every row's flag set non-empty", () => {
    for (const r of all) {
      expect(rowFlags(r).length).toBeGreaterThan(0);
      for (const f of rowFlags(r)) expect(FLAG_VALUES).toContain(f);
    }
    expect(PROPERTY_TYPES).toEqual(["vacant_land", "vacant_building"]);
  });
});

// ── Committed data: every shipped row lands in a bucket ──────────────────────

describe("committed per-ZIP directory files", () => {
  const DIRECTORY_DIR = path.join(process.cwd(), "public", "data", "vacancy-directory");
  const load = (zip: string): VacancyDirectoryFile =>
    JSON.parse(readFileSync(path.join(DIRECTORY_DIR, `${zip}.json`), "utf8")) as VacancyDirectoryFile;

  for (const zip of ["60624", "60617"]) {
    it(`${zip}: every row resolves to exactly one sector, and the buckets reconcile`, () => {
      const file = load(zip);
      expect(file.rows.length).toBeGreaterThan(0);

      const tally: Record<OwnerSector, number> = { public: 0, private: 0, unclassified: 0 };
      for (const r of file.rows) {
        const sector = rowSector(r);
        expect(OWNER_SECTOR_ORDER).toContain(sector);
        // Never blank on screen, whatever the row carries.
        expect(OWNER_SECTOR_ABBREV[sector].length).toBeGreaterThan(0);
        tally[sector] += 1;
      }
      expect(tally.public + tally.private + tally.unclassified).toBe(file.rows.length);
      // Both resolved buckets are genuinely populated in the pilot ZIPs — the
      // column is informative, not a wall of "Not yet classified".
      expect(tally.public).toBeGreaterThan(0);
      expect(tally.private).toBeGreaterThan(0);
    });

    it(`${zip}: every City-Owned Land inventory row reads Public`, () => {
      for (const r of load(zip).rows) {
        if (r.ownerType === "city_public") expect(rowSector(r)).toBe("public");
      }
    });

    it(`${zip}: carries no owner name or mailing address to leak`, () => {
      const keys = new Set(Object.keys(load(zip).rows[0]));
      for (const forbidden of ["ownerName", "taxpayerName", "owner", "mailingAddress"]) {
        expect(keys.has(forbidden)).toBe(false);
      }
    });

    // ── Regression: the ownership taxonomy shipped collapsed. The legacy
    //    owner-TYPE column offered five facets while the committed rows only
    //    ever carried two values (city_public for inventory land, unknown for
    //    every 311 building), so three of the five could never match anything.
    //    The columns now read the axes that ARE populated; these tests hold the
    //    facets to a live count so a future export cannot silently re-collapse
    //    them without turning this red. ──

    it(`${zip}: the shipped rows populate more than two ownership facets`, () => {
      const rows = load(zip).rows;
      const structures = new Set(rows.map((r) => rowStructure(r)));
      const sectors = new Set(rows.map((r) => rowSector(r)));
      expect(structures.size, `${zip} distinct structures`).toBeGreaterThanOrEqual(3);
      expect(sectors.size, `${zip} distinct sectors`).toBeGreaterThanOrEqual(2);
      for (const s of structures) expect(OWNER_STRUCTURE_ORDER).toContain(s);
    });

    it(`${zip}: a reported building whose parcel resolved is not left unclassified`, () => {
      // The enrichment the export writes onto an address-matched 311 row is its
      // taxpayer STRUCTURE. Wherever that resolved, the sector must resolve too
      // — the legacy ownerType stays "unknown" on these rows forever.
      const enriched = load(zip).rows.filter(
        (r) => r.propertyType === "vacant_building" && r.ownerStructure !== "unresolved",
      );
      expect(enriched.length, `${zip} enriched building rows`).toBeGreaterThan(0);
      for (const r of enriched) {
        expect(r.ownerType, `${zip} ${r.address} legacy type`).toBe("unknown");
        expect(rowSector(r), `${zip} ${r.address} sector`).not.toBe("unclassified");
      }
    });

    it(`${zip}: every facet the dropdown offers reports a live count over the rows`, () => {
      // Each dropdown renders its full declared vocabulary with a per-value
      // count computed from the loaded rows. The counts must partition the
      // dataset exactly, so a zero facet is an honest zero and never a stale
      // hard-coded option.
      const rows = load(zip).rows;
      const sectorTotal = OWNER_SECTOR_ORDER.reduce(
        (sum, s) => sum + rows.filter((r) => rowSector(r) === s).length,
        0,
      );
      const structureTotal = OWNER_STRUCTURE_ORDER.reduce(
        (sum, s) => sum + rows.filter((r) => rowStructure(r) === s).length,
        0,
      );
      const typeTotal = PROPERTY_TYPES.reduce(
        (sum, t) => sum + rows.filter((r) => r.propertyType === t).length,
        0,
      );
      expect(sectorTotal).toBe(rows.length);
      expect(structureTotal).toBe(rows.length);
      expect(typeTotal).toBe(rows.length);
      // Flags overlap by design (a row can carry both), so this is a cover, not
      // a partition: every row is counted under at least one flag facet.
      const flagged = rows.filter((r) => rowFlags(r).some((f) => FLAG_VALUES.includes(f)));
      expect(flagged.length).toBe(rows.length);
    });
  }
});

// ── Component smoke ──────────────────────────────────────────────────────────

vi.mock("@/lib/analytics-events", () => ({ trackEvent: vi.fn() }));

describe("VacancyDirectory collapsed state", () => {
  it("still renders the lazy-load affordance after the column rework", () => {
    const html = renderToStaticMarkup(
      <VacancyDirectory zip="60624" neighborhood="West Garfield Park" directoryCount={2760} />,
    );
    expect(html).toContain("Browse all 2,760 tracked addresses");
  });
});
