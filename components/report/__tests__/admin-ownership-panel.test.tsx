import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminOwnershipPanel } from "@/components/report/AdminOwnershipPanel";
import type { OwnerFileReportMatch, OwnerFileReportTopCluster } from "@/lib/owner-file-report-context";

const match: OwnerFileReportMatch = {
  pin: "FAKE-60617-001",
  address: "100 E 100TH ST",
  zip: "60617",
  clusterKey: "mail:fakeowneronellc1standardpkwy",
  ownerName: "FAKE OWNER ONE LLC",
  ownerType: "corporate_llc",
  clusterParcelCount: 6,
  clusterVacantCount: 4,
  confidence: "High",
};

const topClusters: OwnerFileReportTopCluster[] = [
  {
    clusterKey: "mail:fakeowneronellc1standardpkwy",
    zip: "60617",
    ownerName: "FAKE OWNER ONE LLC",
    ownerType: "corporate_llc",
    clusterParcelCount: 6,
    clusterVacantCount: 4,
    confidence: "High",
  },
  {
    clusterKey: "mail:fakeownertwotrustpobox9",
    zip: "60617",
    ownerName: "FAKE OWNER TWO TRUST",
    ownerType: "out_of_state",
    clusterParcelCount: 6,
    clusterVacantCount: 2,
    confidence: "Medium",
  },
];

describe("AdminOwnershipPanel", () => {
  it("renders nothing when idle (non-admin viewer or no resolvable zip)", () => {
    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status="idle" zip={null} match={null} topClusters={[]} />
    );
    expect(html).toBe("");
  });

  it("shows a loading state with the admin badge", () => {
    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status="loading" zip="60617" match={null} topClusters={[]} />
    );
    expect(html).toContain("Admin Only");
    expect(html).toContain("Checking ownership records");
  });

  it("shows an error state", () => {
    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status="error" zip="60617" match={null} topClusters={[]} />
    );
    expect(html).toContain("could not be loaded");
  });

  it("renders the matched parcel's owner, type, confidence, vacancy footprint, and Owner File link", () => {
    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status="ready" zip="60617" match={match} topClusters={[]} />
    );
    expect(html).toContain("FAKE OWNER ONE LLC");
    expect(html).toContain("Corporate / LLC");
    expect(html).toContain("High");
    expect(html).toContain("4 of 6 parcels vacant");
    expect(html).toContain(
      `/admin/owner-files/60617/${encodeURIComponent("mail:fakeowneronellc1standardpkwy")}`
    );
    expect(html).toContain("Open Owner File");
  });

  it("shows a no-match note when the address does not resolve to a parcel", () => {
    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status="ready" zip="60617" match={null} topClusters={[]} />
    );
    expect(html).toContain("No parcel-level ownership match found");
  });

  it("renders the top-clusters list for the ZIP", () => {
    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status="ready" zip="60617" match={null} topClusters={topClusters} />
    );
    expect(html).toContain("Top ownership clusters in ZIP 60617");
    expect(html).toContain("FAKE OWNER ONE LLC");
    expect(html).toContain("FAKE OWNER TWO TRUST");
    expect(html).toContain("Out-of-State Investor");
  });

  it("always shows the internal/verify disclaimer and never suggests the section is shared or emailed", () => {
    const html = renderToStaticMarkup(
      <AdminOwnershipPanel status="ready" zip="60617" match={match} topClusters={topClusters} />
    );
    expect(html).toContain("Internal");
    expect(html).toContain("Not included in shared/emailed reports");
  });

  it("carries the 'Admin Only' badge on every non-idle render", () => {
    for (const status of ["loading", "error", "ready"] as const) {
      const html = renderToStaticMarkup(
        <AdminOwnershipPanel status={status} zip="60617" match={null} topClusters={[]} />
      );
      expect(html).toContain("Admin Only");
    }
  });
});
