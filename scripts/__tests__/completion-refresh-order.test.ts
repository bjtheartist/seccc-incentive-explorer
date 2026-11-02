import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mapSocrata } from "../export-community-investment";
import { normalizeCompletionRefresh } from "../refresh/normalize-completion-refresh";

const row = (name: string, date = "2022-01-01") => ({ project_name: name, applicant_name: name,
  address_number: "123", street_name: "State", street_direction: "S", street_type: "St",
  incentive_amount: "10000", completion_date: date, location: { type: "Point", coordinates: [-87.63, 41.88] } });
const text = (rows: unknown[]) => JSON.stringify(rows) + "\n";

describe("NOF/SBIF refresh preserves accepted positional identities", () => {
  it.each(["nof_small", "nof_large", "sbif"])("normalizes reordered real %s data to exactly unchanged bytes", (name) => {
    const before = readFileSync(join(process.cwd(), `data/curated/investment-inputs/${name}.json`), "utf8");
    const reordered = text(JSON.parse(before).reverse());
    expect(normalizeCompletionRefresh(before, reordered)).toBe(before);
  });

  it("appends an early-sort new row without shifting existing IDs through the REAL mapper", () => {
    const a = row("A"); const b = row("B"); const added = row("Earlier new project", "2020-01-01");
    const before = text([a, b]);
    const fresh = JSON.parse(normalizeCompletionRefresh(before, text([added, b, a])));
    const mapped = mapSocrata(fresh, "sbif", "SBIF", 2020).records;
    expect(mapped.map((r) => [r.id, r.recipient])).toEqual([["sbif-0", "A"], ["sbif-1", "B"], ["sbif-2", "Earlier new project"]]);
    expect(normalizeCompletionRefresh(text(fresh), text([b, a, added]))).toBe(text(fresh));
  });

  it("uses fetched geometry, never silently carries forward the old row", () => {
    const old = row("A");
    const fresh = { ...old, location: { type: "Point", coordinates: [-87.64, 41.89] } };
    expect(JSON.parse(normalizeCompletionRefresh(text([old]), text([fresh])))[0]).toEqual(fresh);
  });

  it("refuses missing/economically changed rows rather than repairing their disappearance", () => {
    const old = row("A");
    expect(() => normalizeCompletionRefresh(text([old]), "[]")).toThrow(/removed\/changed/);
    expect(() => normalizeCompletionRefresh(text([old]), text([{ ...old, incentive_amount: "9999" }]))).toThrow(/human identity review/);
    expect(() => normalizeCompletionRefresh(text([old]), text([{ ...old, completion_date: "2019-01-01" }]))).toThrow(/human identity review/);
  });

  it("refuses coordinate eligibility gain/loss that would change positional numbering", () => {
    const old = row("A");
    const missing = { ...old, location: null };
    expect(() => normalizeCompletionRefresh(text([old]), text([missing]))).toThrow(/coordinate inclusion/);
    expect(() => normalizeCompletionRefresh(text([missing]), text([old]))).toThrow(/coordinate inclusion/);
  });

  it("allows an unchanged identical duplicate pair but refuses ambiguous pairs or multiplicity changes", () => {
    const a = row("A");
    expect(normalizeCompletionRefresh(text([a, a]), text([a, a]))).toBe(text([a, a]));
    const elsewhere = { ...a, location: { type: "Point", coordinates: [-87.64, 41.89] } };
    expect(() => normalizeCompletionRefresh(text([a, elsewhere]), text([elsewhere, a]))).toThrow(/ambiguous duplicate/);
    expect(() => normalizeCompletionRefresh(text([a, a]), text([a]))).toThrow(/multiplicity/);
    expect(() => normalizeCompletionRefresh(text([]), text([a, a]))).toThrow(/ambiguous duplicate/);
  });

  it("requires a valid accepted baseline and a complete object-array fetch", () => {
    expect(() => normalizeCompletionRefresh(null, text([row("A")]))).toThrow(/accepted baseline/);
    expect(() => normalizeCompletionRefresh(text([row("A")]), '{"error":"unavailable"}')).toThrow(/array of row objects/);
    expect(() => normalizeCompletionRefresh(text([row("A")]), "[null]")).toThrow(/array of row objects/);
  });

  it("the REAL default-source runRefresh normalizes NOF Large reorder without any file change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "completion-refresh-real-"));
    const before = readFileSync(join(process.cwd(), "data/curated/investment-inputs/nof_large.json"), "utf8");
    const reversed = JSON.parse(before).reverse();
    writeFileSync(join(dir, "nof_large.json"), before);
    vi.stubEnv("INPUT_DIR", dir);
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/j7ew-b73u.json?");
      const payload = url.includes("count(1)") ? [{ count_1: String(reversed.length) }] : reversed;
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    try {
      const { runRefresh } = await import("../refresh/refresh-live-sources");
      expect(await runRefresh({ only: ["nof-large"], dryRun: false, skipExport: true, summaryOut: null })).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(readFileSync(join(dir, "nof_large.json"), "utf8")).toBe(before);
      expect(existsSync(join(dir, "refresh-attempt.json"))).toBe(false);
      expect(existsSync(join(dir, "manifest.json"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
