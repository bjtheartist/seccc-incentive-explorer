import { describe, expect, it } from "vitest";
import {
  buildVacancyViolationImport,
  fetchVacancyViolationRecords,
  type VacancyViolationRecord,
} from "../vacancy-violation-signals";

const NOW = new Date("2026-09-08T20:00:00Z");
const base: VacancyViolationRecord = {
  id: "7527966", property_group: "348192", address: "5725 S LAFLIN ST",
  latitude: "41.7896561485", longitude: "-87.6618873906",
  violation_code: "CN193105", violation_description: "VACANTBUILDING-REGISTER/SECURE",
  violation_date: "2026-08-06T00:00:00.000", violation_status: "OPEN",
  violation_inspector_comments: "REGISTER VACANT BUILDING AND KEEP SECURE.",
};

describe("vacancy violation import", () => {
  it("retains the source date, open status, citation, scope and exact record link", () => {
    const { signals } = buildVacancyViolationImport([base], NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ id: "violation-building-group-348192", source: "violations", status: "OPEN", source_dataset_id: "22u3-xenr", source_record_date: "2026-08-06T00:00:00.000Z", source_row_id: "7527966", property_status: "Vacancy citation: REGISTER VACANT BUILDING AND KEEP SECURE." });
    expect(new URL(signals[0].source_url).searchParams.get("$where")).toBe("id='7527966'");
  });

  it.each(["CN192019", "CN070014", "CN193301"])("excludes land or nonspecific citations (%s)", (code) => {
    expect(buildVacancyViolationImport([{ ...base, violation_code: code }], NOW).signals).toEqual([]);
  });

  it("enforces the Chicago five-year date boundary and rejects future or invalid dates", () => {
    for (const date of ["2021-09-07", "2026-09-09", "2026-02-30", "bad"]) {
      expect(buildVacancyViolationImport([{ ...base, violation_date: date }], NOW).signals).toEqual([]);
    }
    expect(buildVacancyViolationImport([{ ...base, violation_date: "2021-09-08" }], NOW).signals).toHaveLength(1);
  });

  it("does not use a recent modification date to revive an old citation", () => {
    expect(buildVacancyViolationImport([{ ...base, violation_date: "2010-01-01", violation_last_modified_date: "2026-09-08" }], NOW).signals).toEqual([]);
  });

  it.each(["COMPLIED", "NO ENTRY", "", undefined])("withholds non-open status (%s)", (status) => {
    expect(buildVacancyViolationImport([{ ...base, violation_status: status }], NOW).signals).toEqual([]);
  });

  it("deduplicates multiple citations and alternate addresses within one property group", () => {
    const result = buildVacancyViolationImport([base, { ...base, id: "old", address: "5727 S LAFLIN ST", violation_date: "2025-01-01" }], NOW);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].address).toBe(base.address);
    expect(result.signals[0].source_row_id).toBe(base.id);
  });

  it("withholds an older open citation if the latest vacancy citation is resolved", () => {
    const result = buildVacancyViolationImport([base, { ...base, id: "new", violation_date: "2026-09-01", violation_status: "COMPLIED" }], NOW);
    expect(result.signals).toEqual([]);
    expect(result.notOpen).toBe(1);
  });

  it("withholds contradictory open/resolved citations from the same day", () => {
    expect(buildVacancyViolationImport([base, { ...base, id: "resolved", violation_status: "COMPLIED" }], NOW).signals).toEqual([]);
  });

  it("preserves partial vacancy comments instead of asserting a wholly vacant building", () => {
    const result = buildVacancyViolationImport([{ ...base, violation_inspector_comments: "APROX. 75% OF THE BUILDING IS CURRENTLY VACANT AND BOARDED." }], NOW);
    expect(result.signals[0].property_status).toContain("75%");
  });

  it("uses a stable normalized-address fallback without guessing a PIN", () => {
    const result = buildVacancyViolationImport([{ ...base, property_group: undefined }, { ...base, id: "other", property_group: undefined, address: "5725 s. Laflin st" }], NOW);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).not.toHaveProperty("pin");
  });

  it.each([undefined, "", "NaN", "0", "45"])("rejects invalid latitude (%s)", (latitude) => {
    expect(buildVacancyViolationImport([{ ...base, latitude }], NOW).signals).toEqual([]);
  });

  it("pulls official codes across all statuses with a five-year window", async () => {
    let requested = "";
    await fetchVacancyViolationRecords(NOW, (async (url) => {
      requested = String(url);
      return new Response(JSON.stringify([base]));
    }) as typeof fetch);
    const url = new URL(requested);
    expect(url.pathname).toBe("/resource/22u3-xenr.json");
    expect(url.searchParams.get("$where")).toContain("2021-09-08");
    expect(url.searchParams.get("$where")).not.toContain("violation_status");
  });

  it("throws on a failed later page instead of producing a partial import", async () => {
    let calls = 0;
    await expect(fetchVacancyViolationRecords(NOW, (async () => {
      calls += 1;
      return calls === 1 ? new Response(JSON.stringify(Array(1000).fill(base))) : new Response("down", { status: 503 });
    }) as typeof fetch)).rejects.toThrow("503 at offset 1000");
  });
});
