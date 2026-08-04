import { describe, expect, it } from "vitest";
import {
  INVESTMENT_SOURCES,
  type CommunityInvestmentMeta,
} from "@/lib/community-investment";
import {
  COVERAGE_STATES,
  buildSourceCoverageRows,
} from "@/lib/investment-source-coverage";

function meta(): CommunityInvestmentMeta {
  const counts = Object.fromEntries(INVESTMENT_SOURCES.map((source) => [source, 0])) as CommunityInvestmentMeta["counts"];
  counts["nof-small"] = 10;
  counts["nof-large"] = 2;
  counts.sbif = 30;
  counts.foundation = 200;
  counts["cook-source-2023"] = 50;
  counts["illinois-big"] = 60;
  counts["illinois-hospitality-emergency"] = 7;
  counts["illinois-b2b"] = 80;
  return { counts } as CommunityInvestmentMeta;
}

describe("source coverage registry", () => {
  it("derives released counts only from aggregate export metadata", () => {
    const rows = buildSourceCoverageRows(meta());
    expect(rows.find((row) => row.id === "city-completions")?.releasedRecords).toBe(42);
    expect(rows.find((row) => row.id === "recovery-aggregates")?.releasedRecords).toBe(197);
  });

  it("uses only the five approved categorical states", () => {
    for (const row of buildSourceCoverageRows(meta())) {
      for (const cell of Object.values(row.coverage)) {
        expect(COVERAGE_STATES).toContain(cell.state);
      }
    }
  });

  it("keeps foundation holds quarantined and recovery geography aggregate-only", () => {
    const rows = buildSourceCoverageRows(meta());
    const foundation = rows.find((row) => row.id === "foundation-filings");
    const recovery = rows.find((row) => row.id === "recovery-aggregates");
    expect(foundation?.coverage.capture.state).toBe("partial");
    expect(foundation?.coverage.review.state).toBe("quarantined");
    expect(recovery?.coverage.map_detail.state).toBe("aggregate_only");
  });

  it("does not encode percentage claims in any diagnostic", () => {
    const details = buildSourceCoverageRows(meta()).flatMap((row) =>
      Object.values(row.coverage).map((cell) => cell.detail),
    );
    expect(details.join(" ")).not.toMatch(/\d+(?:\.\d+)?%/);
  });
});
