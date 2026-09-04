// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AreaStats } from "../map-helpers";
import type { SiteSignals } from "@/lib/site-signals";
import type { MapDossierSelection } from "@/lib/map-dossier";

vi.mock("@/components/workspace/WatchAreaButton", () => ({
  WatchAreaButton: () => <button type="button">Watch this area</button>,
}));

const MapDossierCard = (await import("../MapDossierCard")).default;
const MapSnapshotPanel = (await import("../MapSnapshotPanel")).default;

/**
 * Owner ask: "could we put the details of those records so we can back trace
 * to them". The counts and their disclaimers are unchanged; each count row is
 * now a collapsed disclosure that opens onto the individual records, each with
 * its identifier and a link to the agency that publishes it.
 */

const SITE_SIGNALS: SiteSignals = {
  brownfield: null,
  openLustNearby: 1,
  nearestOpenLust: { name: "Monterey Gas", miles: 0.12 },
  nofAwardsNearby: 1,
  incentiveParcelsNearby: 0,
  nearestIncentiveParcel: null,
  records: {
    openLust: {
      records: [
        {
          id: "lust-20000054",
          name: "Monterey Gas",
          address: "11201-11203 South Vincennes Avenue",
          miles: 0.12,
          facts: ["Incident no. 20000054", "Status: Open"],
          sourceLabel: "Illinois EPA leaking-UST incident lookup",
          sourceUrl:
            "https://epa.illinois.gov/topics/cleanup-programs/bol-database/leaking-ust.html",
        },
      ],
      truncated: 2,
    },
    nofAwards: {
      records: [
        {
          id: "nof-2020-12-22-0",
          name: "Natural Roots Kids Hair, LLC",
          address: "1851-1855 E 87th St",
          miles: 0.31,
          facts: ["NOF Small grant: $190,726", "Approved 2020-12-22", "Ward 8 · Calumet Heights"],
          sourceLabel: "Chicago Data Portal — NOF Small financial incentive projects",
          sourceUrl: "https://data.cityofchicago.org/d/rym7-49n8",
        },
      ],
      truncated: 0,
    },
    incentiveParcels: { records: [], truncated: 0 },
    brownfields: { records: [], truncated: 0 },
  },
};

const AREA_STATS: AreaStats = {
  medianHomePrice: "$142,000",
  medianIncome: "$38,500",
  walkScore: 11,
  siteSignals: SITE_SIGNALS,
};

const SELECTION: MapDossierSelection = {
  kind: "address",
  title: "3022 E 91st St",
  lat: 41.73035,
  lon: -87.55024,
};

function renderDossier(areaStats: AreaStats = AREA_STATS) {
  return render(
    <MapDossierCard
      areaStats={areaStats}
      snapshotLabel="3022 E 91st St"
      snapshotLat={41.73035}
      snapshotLon={-87.55024}
      snapshotPrograms={[]}
      snapshotTifFinance={null}
      snapshotZoneCoverageNote={null}
      tifFinanceLoading={false}
      zoningInfo={null}
      isGeneratingSnapshot={false}
      selection={SELECTION}
      onClose={() => {}}
      onDrawArea={() => {}}
      onGenerateSnapshot={() => {}}
    />,
  );
}

function renderSnapshot(areaStats: AreaStats = AREA_STATS) {
  return render(
    <MapSnapshotPanel
      areaStats={areaStats}
      snapshotLabel="3022 E 91st St"
      snapshotLat={41.73035}
      snapshotLon={-87.55024}
      snapshotPrograms={[]}
      snapshotTifFinance={null}
      tifFinanceLoading={false}
      zoningInfo={null}
      isGeneratingSnapshot={false}
      onClose={() => {}}
      onDrawArea={() => {}}
      onGenerateSnapshot={() => {}}
    />,
  );
}

/** Open the <details> that owns this summary, the way a click does. */
function expand(summary: HTMLElement): HTMLElement {
  fireEvent.click(summary);
  const disclosure = summary.closest("details") as HTMLDetailsElement;
  // jsdom does not always run <summary> activation behaviour; the click above
  // is the real entry point, this keeps the assertion honest either way.
  if (!disclosure.open) disclosure.open = true;
  expect(disclosure.open).toBe(true);
  return disclosure;
}

afterEach(cleanup);

describe("nearby public records back-trace to their source", () => {
  it("expands a tank-leak count in the dossier card onto the incident record and its agency link", () => {
    renderDossier();

    const row = screen.getByText("Open tank-leak records within 1/4 mi");
    // The count itself is unchanged and visible before anything is expanded.
    expect(row.closest("summary")).not.toBeNull();
    expect(row.closest("summary")!.textContent).toContain("1");

    const disclosure = expand(row.closest("summary")!);
    const records = within(disclosure);

    expect(records.getByText("Monterey Gas")).toBeTruthy();
    expect(records.getByText(/11201-11203 South Vincennes Avenue/)).toBeTruthy();
    expect(records.getByText(/0\.1 mi/)).toBeTruthy();
    expect(records.getByText(/Incident no\. 20000054/)).toBeTruthy();
    expect(records.getByText(/and 2 more/)).toBeTruthy();

    const link = records.getByRole("link", {
      name: /Illinois EPA leaking-UST incident lookup/,
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "https://epa.illinois.gov/topics/cleanup-programs/bol-database/leaking-ust.html",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the awarded business behind an NOF count, never the applicant's personal name", () => {
    renderDossier();

    const disclosure = expand(
      screen.getByText("NOF grants funded within 1/2 mi").closest("summary")!,
    );
    const records = within(disclosure);

    expect(records.getByText("Natural Roots Kids Hair, LLC")).toBeTruthy();
    expect(records.getByText(/NOF Small grant: \$190,726/)).toBeTruthy();
    expect(
      (records.getByRole("link", { name: /NOF Small/ }) as HTMLAnchorElement).getAttribute("href"),
    ).toBe("https://data.cityofchicago.org/d/rym7-49n8");
    expect(document.body.textContent).not.toContain("Tess McKenzie");
  });

  it("keeps the nearby-records disclaimer verbatim", () => {
    renderDossier();

    expect(
      screen.getByText(
        "Nearby public records provide context only. Verify current conditions with the source agencies.",
      ),
    ).toBeTruthy();
  });

  it("expands the same records in the compact snapshot panel", () => {
    renderSnapshot();

    const disclosure = expand(
      screen.getByText("Open tank-leak incidents within 1/4 mi").closest("summary")!,
    );
    const records = within(disclosure);

    expect(records.getByText("Monterey Gas")).toBeTruthy();
    expect(records.getByText(/Incident no\. 20000054/)).toBeTruthy();
    expect(
      (records.getByRole("link", { name: /Illinois EPA/ }) as HTMLAnchorElement).getAttribute("href"),
    ).toContain("leaking-ust.html");
    expect(
      screen.getByText(
        "Nearby funding precedents and environmental flags from public data. Verify with the administering agencies before relying on them.",
      ),
    ).toBeTruthy();
  });

  it("leaves the count rows as plain rows when a snapshot carries no records", () => {
    const { records: _records, ...withoutRecords } = SITE_SIGNALS;
    renderDossier({ ...AREA_STATS, siteSignals: withoutRecords });

    const row = screen.getByText("Open tank-leak records within 1/4 mi");
    expect(row.closest("summary")).toBeNull();
    expect(row.parentElement!.textContent).toContain("1");
  });
});
