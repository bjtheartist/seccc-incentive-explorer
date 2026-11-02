import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateTifRefresh } from "../refresh/refresh-live-sources";

const header = "dataset,project_name,tif_district,source_row_id,authorized_tif_assistance\n";
const rda = (id: number, ordinal = 0) => `rda-iga,Project ${id},District,rda-iga:${id}:${ordinal},100\n`;
const annual = (district: string) => `annual-report,Annual project,${district},annual-report:T-T-011:2018:2:1,\n`;

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("TIF refresh integrity before writes", () => {
  it.each(["ERROR: #N/A", "#N/A", "#REF!", "", " error: missing "])("rejects invalid annual district %j", (district) => {
    expect(() => validateTifRefresh(header + rda(1) + annual("105th/Vincennes"), header + rda(1) + annual(district)))
      .toThrow(/invalid district label/);
  });

  it("rejects historical project disappearance even when net rows and dollars increase", () => {
    expect(() => validateTifRefresh(header + rda(1) + rda(2), header + rda(1) + rda(3) + rda(4)))
      .toThrow(/rda-iga:2.*human review.*net count grew/);
  });

  it("does not confuse positional suffix changes with historical project removal", () => {
    expect(() => validateTifRefresh(header + rda(1, 0), header + rda(3, 0) + rda(1, 1)))
      .not.toThrow();
  });

  it("rejects duplicated or missing native identities", () => {
    expect(() => validateTifRefresh(null, header + rda(1, 0) + rda(1, 1))).toThrow(/duplicate source identity/);
    expect(() => validateTifRefresh(null, header + "rda-iga,Project,District,,100\n")).toThrow(/source_row_id/);
  });

  it("the REAL TIF builder/runner rejects corrupt upstream data, retains prior CSV, and records failure", async () => {
    const temp = mkdtempSync(join(tmpdir(), "refresh-tif-integrity-"));
    try {
      vi.stubEnv("INPUT_DIR", temp);
      vi.resetModules();
      const before = header + rda(1) + rda(2) + annual("105th/Vincennes");
      writeFileSync(join(temp, "tif_projects.csv"), before);
      vi.stubGlobal("fetch", vi.fn(async (input: string) => {
        const url = new URL(input);
        const rows = url.pathname.includes("mex4-ppfc")
          ? [1, 3, 4].map((id) => ({ id: String(id), project_name: `Project ${id}`, tif_district: "District", approved_amount: "100" }))
          : [{ tif_number: "T-T-011", report_year: "2018", project_number: "2", project_name: "Annual project", tif_district: "ERROR: #N/A" }];
        return new Response(JSON.stringify(url.searchParams.has("$select") ? [{ count_1: String(rows.length) }] : rows), {
          headers: { "Content-Type": "application/json" },
        });
      }));
      const { runRefresh } = await import("../refresh/refresh-live-sources");
      expect(await runRefresh({ dryRun: false, skipExport: true, only: ["tif"], summaryOut: null })).toBe(false);
      expect(readFileSync(join(temp, "tif_projects.csv"), "utf8")).toBe(before);
      const artifact = JSON.parse(readFileSync(join(temp, "refresh-attempt.json"), "utf8"));
      expect(artifact.failedSources).toHaveLength(1);
      expect(artifact.failedSources[0].id).toBe("tif");
      expect(artifact.failedSources[0].error).toContain("invalid district label");
      expect(artifact.failedSources[0].error).toContain("rda-iga:2");
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
