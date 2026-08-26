import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AreaStats } from "../map-helpers";
import { buildMapVacancySelectionEvidence } from "../map-vacancy-selection";

vi.mock("@/components/workspace/WatchAreaButton", () => ({
  WatchAreaButton: () => <button type="button">Watch this area</button>,
}));

const MapDossierCard = (await import("../MapDossierCard")).default;

const BASE_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
};

describe("base-map vacancy selection provenance", () => {
  it("keeps a published CCLBA PIN and labels the popup as Cook County Land Bank inventory", () => {
    const evidence = buildMapVacancySelectionEvidence({
      id: "cclba-52905642",
      source: "cclba",
      pin: "16141010090000",
      sourceRecordDate: null,
    });
    const html = renderToStaticMarkup(
      <MapDossierCard
        areaStats={BASE_STATS}
        snapshotLabel="3856 W Monroe St"
        snapshotPrograms={[]}
        snapshotTifFinance={null}
        tifFinanceLoading={false}
        zoningInfo={null}
        isGeneratingSnapshot={false}
        selection={{
          kind: "vacancy",
          title: "3856 W Monroe St",
          vacancyType: "vacant_land",
          ...evidence,
        }}
        onClose={() => {}}
        onDrawArea={() => {}}
        onGenerateSnapshot={() => {}}
      />,
    );

    expect(evidence.pin).toBe("16141010090000");
    expect(html).toContain("PIN");
    expect(html).toContain("16141010090000");
    expect(html).toContain(
      "Cook County Land Bank Authority Published Property Inventory",
    );
    expect(html).not.toContain("City-Owned Land Inventory");
    expect(html).not.toContain("311 Vacant/Abandoned Building Complaint");
  });

  it("rejects malformed published PINs while retaining the legacy COLS ID fallback", () => {
    expect(
      buildMapVacancySelectionEvidence({
        id: "cclba-52905642",
        source: "cclba",
        pin: "16-14-101-009-0000",
      }).pin,
    ).toBeNull();

    expect(
      buildMapVacancySelectionEvidence({
        id: "cols-16153030120000",
        source: "cols",
      }).pin,
    ).toBe("16153030120000");

    expect(
      buildMapVacancySelectionEvidence({
        id: "cols-16153030120000",
        source: "cols",
        pin: "16141010090000",
      }).pin,
    ).toBe("16141010090000");
  });
});
