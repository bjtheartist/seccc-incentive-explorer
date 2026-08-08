import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INVESTMENT_SOURCES } from "../community-investment";
import { parseDelimited } from "../../scripts/export-community-investment";

const INPUT_PATH = join(
  process.cwd(),
  "data",
  "curated",
  "investment-inputs",
  "impact_grants_chicago_DO_NOT_EXPORT.csv",
);
const SOURCE_PAGE =
  "https://www.impactgrantschicago.org/all-grant-recipients/";

function inputRows(): Record<string, string>[] {
  return parseDelimited(readFileSync(INPUT_PATH, "utf8"), ",");
}

describe("held Impact Grants Chicago recipient roster", () => {
  it("pins the official source snapshot while keeping it out of the export", () => {
    const rows = inputRows();
    const ids = new Set(rows.map((row) => row.record_id));
    const total = rows.reduce(
      (sum, row) => sum + Number(row.amount_usd),
      0,
    );

    expect(rows).toHaveLength(69);
    expect(ids.size).toBe(rows.length);
    expect(total).toBe(4_425_000);
    expect(rows.filter((row) => row.grant_type === "Impact Grant")).toHaveLength(37);
    expect(rows.filter((row) => row.grant_type === "Merit Grant")).toHaveLength(32);
    expect(new Set(rows.map((row) => row.source_url))).toEqual(
      new Set([SOURCE_PAGE]),
    );
    expect(new Set(rows.map((row) => row.source_checked_at))).toEqual(
      new Set(["2026-08-08"]),
    );
    expect(INVESTMENT_SOURCES).not.toContain("impact-grants");
  });

  it("contains no inferred address, ZIP, or coordinate fields", () => {
    const rows = inputRows();
    const fields = Object.keys(rows[0] ?? {});

    expect(fields).not.toContain("address");
    expect(fields).not.toContain("zip");
    expect(fields).not.toContain("lat");
    expect(fields).not.toContain("lng");
    expect(rows.every((row) => Number(row.amount_usd) > 0)).toBe(true);
    expect(rows.every((row) => Number(row.award_year) >= 2018)).toBe(true);
  });
});
