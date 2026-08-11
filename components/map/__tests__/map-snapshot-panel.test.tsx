import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AreaStats } from "../map-helpers";
import type { ProgramCheckResult } from "@/lib/types";

vi.mock("@/components/workspace/WatchAreaButton", () => ({
  WatchAreaButton: () => <button type="button">Watch this area</button>,
}));

const MapSnapshotPanel = (await import("../MapSnapshotPanel")).default;

const AREA_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
  parcelPin: "25123140010000",
  parcelClass: "5-17",
};

const INTERNAL_PROGRAM_RESULT: ProgramCheckResult & { score: number } = {
  programId: "sbif",
  program: {
    id: "sbif",
    name: "Small Business Improvement Fund",
    level: "City",
    zoneKey: "tif",
    summary: "Published program summary.",
    whoQualifies: "Published applicant requirements.",
    benefits: [],
    howToApply: [],
    requiredDocs: [],
    contact: "SomerCor",
    url: "https://www.chicago.gov/sbif",
    sourceUrl: "https://www.chicago.gov/sbif/source",
  },
  // Deliberately adversarial payload: the retired eligibility vocabulary in
  // the label/why strings must never reach the rendered panel.
  relevance: "mapped_with_matching_answers",
  relevanceLabel: "High Match — Appears eligible",
  whyOneLine: "You qualify for this program.",
  benefitRange: "$75,000–$250,000 possible incentive dollars",
  fastestStep: "Contact the administrator",
  notVerified: [],
  matchedRules: [],
  score: 97,
};

function renderPanel(snapshotPrograms: ProgramCheckResult[] = []): string {
  return renderToStaticMarkup(
    <MapSnapshotPanel
      areaStats={AREA_STATS}
      snapshotLabel="3022 E 91st St"
      snapshotLat={41.73035}
      snapshotLon={-87.55024}
      snapshotPrograms={snapshotPrograms}
      snapshotTifFinance={null}
      tifFinanceLoading={false}
      zoningInfo="M1-2 — Limited manufacturing and business park district"
      isGeneratingSnapshot={false}
      onClose={() => {}}
      onDrawArea={() => {}}
      onGenerateSnapshot={() => {}}
    />,
  );
}

describe("MapSnapshotPanel", () => {
  it("restores the standalone location snapshot experience", () => {
    const html = renderPanel();

    expect(html).toContain("Location Snapshot");
    expect(html).toContain("3022 E 91st St");
    expect(html).toContain("Search or tap the map to update");
    expect(html).toContain("Generate Location Snapshot");
    expect(html).not.toContain("Selected map location details");
    expect(html).not.toContain("<details");
  });

  it("keeps the original at-a-glance location context", () => {
    const html = renderPanel();

    expect(html).toContain("Median Home Price");
    expect(html).toContain("$142,000");
    expect(html).toContain("Median Income");
    expect(html).toContain("$38,500");
    expect(html).toContain("EPA Walkability Index");
    expect(html).toContain("11/20");
    expect(html).toContain("M1-2");
    expect(html).toContain("25123140010000");
  });

  it("does not expose internal match scoring or a projected incentive total", () => {
    const html = renderPanel([INTERNAL_PROGRAM_RESULT]);

    expect(html).toContain("Mapped Programs to Review");
    expect(html).toContain("Small Business Improvement Fund");
    expect(html).toContain("Mapped boundary intersects this location.");
    expect(html).toContain("Review source");
    expect(html).toContain(
      "Boundary intersection does not confirm applicant or project eligibility, funding availability, or approval.",
    );
    expect(html).not.toMatch(/match score|eligibility score|high match|appears eligible|you qualify/i);
    expect(html).not.toMatch(/\$75,000|\$250,000|possible incentive dollars|total incentive/i);
    expect(html).not.toContain("97");
  });
});
