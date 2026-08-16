// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  siteShortlistFeatureGoogleMapsUrl,
  siteShortlistPinPopupHtml,
} from "@/components/vacancy/SiteShortlistMap";

describe("Site Shortlist map popup", () => {
  it("carries the stable candidate key into a 44px dossier action and preserves the encoded Google Maps link", () => {
    const html = siteShortlistPinPopupHtml({
      markerNumber: 1,
      key: "candidate-01",
      address: "3040 S HOMAN AVE",
      zoningDistrict: "C1-2",
      zoningBadge: "Broad family alignment",
      badge: "aligned",
      domId: "shortlist-card-candidate-01",
      googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=3040+S+HOMAN+AVE%2C+Chicago%2C+IL+60623",
    });
    expect(html).toContain('data-shortlist-parcel-details="candidate-01"');
    expect(html).toContain("min-height:44px");
    expect(html).toContain("Google Maps");
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("rel=\"noopener noreferrer\"");
    expect(html).toContain("query=3040+S+HOMAN+AVE%2C+Chicago%2C+IL+60623");
  });

  it("escapes source-controlled address, key, and URL values", () => {
    const html = siteShortlistPinPopupHtml({
      markerNumber: 2,
      key: '\"><img src=x onerror=alert(1)>',
      address: "<script>alert(1)</script>",
      badge: "unresolved",
      googleMapsUrl: 'https://example.test/\" onclick=\"alert(1)',
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onclick="alert(1)');
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses the candidate feature coordinate—not the user's click point—for a placeholder-address fallback", () => {
    const url = new URL(siteShortlistFeatureGoogleMapsUrl({
      properties: { address: "Address not published" },
      geometry: { type: "Point", coordinates: [-87.70998, 41.83776] },
    }, "60623")!);
    expect(url.searchParams.get("query")).toBe("41.837760,-87.709980");
  });

  it("does not manufacture a map destination from invalid feature geometry", () => {
    expect(siteShortlistFeatureGoogleMapsUrl({
      properties: { address: "N/A" },
      geometry: { type: "Point", coordinates: [999, 999] },
    }, "60623")).toBeNull();
    expect(siteShortlistFeatureGoogleMapsUrl({
      properties: { address: "N/A" },
      geometry: { type: "LineString", coordinates: [[-87.7, 41.8]] },
    }, "60623")).toBeNull();
  });
});
