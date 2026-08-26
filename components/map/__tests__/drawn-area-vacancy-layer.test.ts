import { describe, expect, it, vi } from "vitest";
import {
  buildDrawnAreaVacancyPopupHtml,
  DRAWN_AREA_VACANCY_SOURCE_ID,
  setDrawnAreaVacancySignals,
} from "@/components/map/drawn-area-vacancy-layer";

describe("drawn-area vacancy map layer", () => {
  it("updates the stable source identity with the displayed feature set", () => {
    const setData = vi.fn();
    const getSource = vi.fn().mockReturnValue({ setData });
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-87.6, 41.8] },
      properties: { id: "p-1" },
    };
    setDrawnAreaVacancySignals({ getSource }, [feature]);
    expect(getSource).toHaveBeenCalledWith(DRAWN_AREA_VACANCY_SOURCE_ID);
    expect(setData).toHaveBeenCalledWith({
      type: "FeatureCollection",
      features: [feature],
    });
  });

  it("shows source date and conflict evidence without allowing popup HTML injection", () => {
    const html = buildDrawnAreaVacancyPopupHtml({
      address: "<script>alert(1)</script>",
      source: "311_clean_lot",
      status: "Completed",
      canonicalType: "land",
      freshnessClass: "stale",
      sourceRecordDate: "2021-07-01T00:00:00.000Z",
      currentLicenseMatches: [
        { name: "Cafe <b>", status: "AAI", expirationDate: "2027-01-01" },
      ],
    });
    expect(html).toContain("311 Clean Vacant Lot Request");
    expect(html).toContain("2021-07-01");
    expect(html).toContain("Source status");
    expect(html).toContain("Completed");
    expect(html).toContain("Current-license conflict");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Cafe <b>");
  });

  it("distinguishes proved official CCLBA inventory from metadata-less records", () => {
    const official = buildDrawnAreaVacancyPopupHtml({
      address: "7900 S TEST AVE",
      source: "cclba",
      sourceDatasetId: "epropertyplus-published-properties",
      sourceUrl: "https://public-cclba.epropertyplus.com/",
      canonicalType: "land",
      freshnessClass: "unknown_date",
    });
    const unknown = buildDrawnAreaVacancyPopupHtml({
      address: "7902 S TEST AVE",
      source: "cclba",
      canonicalType: "land",
      freshnessClass: "unknown_date",
    });

    expect(official).toContain(
      "Cook County Land Bank Authority Published Property Inventory",
    );
    expect(unknown).toContain("Cook County Land Bank Authority public record");
    expect(unknown).not.toContain(
      "Cook County Land Bank Authority Published Property Inventory",
    );
  });

  it.each([
    ["unavailable", "license source was unavailable"],
    ["not_checked_cap", "500-address screening cap"],
    ["not_checked_address", "no usable exact address"],
    ["no_match", "Exact address checked"],
  ])("keeps %s distinct from a clean no-match", (state, expected) => {
    const html = buildDrawnAreaVacancyPopupHtml({
      address: "1 TEST ST",
      source: "dpd_vacant",
      canonicalType: "building",
      freshnessClass: "recent",
      sourceRecordDate: "2026-01-01T00:00:00.000Z",
      licenseCheckState: state,
      currentLicenseMatches: [],
    });
    expect(html).toContain(expected);
  });
});
