import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AreaStats } from "../map-helpers";

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

function renderPanel(): string {
  return renderToStaticMarkup(
    <MapSnapshotPanel
      areaStats={AREA_STATS}
      snapshotLabel="3022 E 91st St"
      snapshotLat={41.73035}
      snapshotLon={-87.55024}
      snapshotPrograms={[]}
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
    const html = renderPanel();

    expect(html).not.toContain("Match score");
    expect(html).not.toContain("Eligibility score");
    expect(html).not.toContain("Potential incentive dollars");
    expect(html).not.toContain("Total incentive");
  });
});
