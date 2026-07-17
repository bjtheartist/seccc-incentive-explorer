import { describe, expect, it } from "vitest";
import { buildOwnerClusterPopupHtml } from "../map-helpers";
import { OWNER_TYPE_LABELS } from "@/lib/owner-classify";

/**
 * Content contract for the admin ownership-cluster popup
 * (MapView's map.on("click", "owner-clusters-unclustered") handler),
 * exercised against the extracted builder since the click itself needs a
 * live Mapbox map. Cluster keys contain ':' ("mail:…"/"owner:…"/"pin:…"),
 * so the Owner File href MUST percent-encode them — the dossier route
 * decodes with decodeURIComponent (app/api/owner-file/[clusterKey]).
 */
describe("buildOwnerClusterPopupHtml", () => {
  const baseProps = {
    pin: "FAKE-60617-001",
    address: "100 E 100TH ST",
    vacant: true,
    zip: "60617",
    clusterKey: "mail:fakeowneronellc1standardpkwy",
    ownerName: "FAKE OWNER ONE LLC",
    ownerType: "corporate_llc",
    clusterParcelCount: 6,
    clusterVacantCount: 4,
    confidence: "High",
  };

  it("renders owner name bold, the owner-type chip, the confidence badge, the vacancy line, and the address", () => {
    const html = buildOwnerClusterPopupHtml(baseProps);
    expect(html).toContain("FAKE OWNER ONE LLC");
    expect(html).toMatch(/font-weight:600[^>]*>FAKE OWNER ONE LLC</);
    expect(html).toContain(OWNER_TYPE_LABELS.corporate_llc); // "Corporate / LLC"
    expect(html).toContain("High"); // confidence tier badge
    expect(html).toContain("4 vacant / 6 parcels");
    expect(html).toContain("100 E 100TH ST");
    expect(html).toContain("Admin · Ownership Cluster");
  });

  it("orders content owner+chip+confidence, then the vacancy metric, then the address", () => {
    const html = buildOwnerClusterPopupHtml(baseProps);
    const ownerIdx = html.indexOf("FAKE OWNER ONE LLC");
    const confidenceIdx = html.indexOf(">High<");
    const metricIdx = html.indexOf("4 vacant / 6 parcels");
    const addressIdx = html.indexOf("100 E 100TH ST");
    expect(ownerIdx).toBeGreaterThanOrEqual(0);
    expect(confidenceIdx).toBeGreaterThan(ownerIdx);
    expect(metricIdx).toBeGreaterThan(confidenceIdx);
    expect(addressIdx).toBeGreaterThan(metricIdx);
  });

  it("links to the Owner File with zip and a percent-encoded clusterKey (':' included)", () => {
    const html = buildOwnerClusterPopupHtml(baseProps);
    const expectedHref = `/admin/owner-files/60617/${encodeURIComponent("mail:fakeowneronellc1standardpkwy")}`;
    expect(expectedHref).toContain("mail%3A"); // the ':' really is encoded
    expect(html).toContain(`href="${expectedHref}"`);
    expect(html).toContain("Open Owner File");
    // The raw (unencoded) key must not appear inside the href.
    expect(html).not.toContain('href="/admin/owner-files/60617/mail:');
  });

  it("falls back cleanly when owner fields are missing", () => {
    const html = buildOwnerClusterPopupHtml({
      zip: "60624",
      clusterKey: "pin:123",
      clusterParcelCount: 1,
      clusterVacantCount: 0,
    });
    expect(html).toContain("Owner record unavailable");
    expect(html).toContain(OWNER_TYPE_LABELS.unknown);
    expect(html).toContain("0 vacant / 1 parcels");
    // No address block when address is absent, and no confidence badge when confidence is absent.
    expect(html).not.toContain("text-overflow:ellipsis");
    expect(html).not.toContain("letter-spacing:0.04em");
  });

  it("escapes HTML in data-derived fields (owner name / address)", () => {
    const html = buildOwnerClusterPopupHtml({
      ...baseProps,
      ownerName: 'EVIL <img src=x onerror="x()"> & CO',
      address: '1 <script>alert("x")</script> ST',
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("EVIL &lt;img");
    expect(html).toContain("&amp; CO");
  });
});
