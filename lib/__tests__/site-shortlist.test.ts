import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONDITION_VERIFICATION_NOTE,
  IMPLIED_VALUE_CAPTION,
  SHORTLIST_SNAPSHOT_SOURCE,
  VIOLATION_FLAG,
  accessibilityNoteFor,
  activeLicenseFlag,
  approxDistanceMeters,
  countyClassGloss,
  impliedMarketValue,
  isCtaStation,
  isMetraStation,
  nearestStation,
  ownerAxesLabel,
  shortlistSnapshotHref,
  taxSaleFlag,
  type ShortlistStation,
} from "../site-shortlist";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** 79th & Cottage Grove-ish; the Chatham corridor the pipeline was born on. */
const BASE_LAT = 41.75;
const BASE_LON = -87.605;

const CTA_NEAR: ShortlistStation = {
  name: "79th",
  system: "CTA",
  lat: BASE_LAT + 0.001,
  lon: BASE_LON,
};
const METRA_FAR: ShortlistStation = {
  name: "83rd Street",
  system: "Metra Electric",
  lat: BASE_LAT + 0.05,
  lon: BASE_LON,
};
const STATIONS = [CTA_NEAR, METRA_FAR];

// ── Geometry ─────────────────────────────────────────────────────────────────

describe("approxDistanceMeters", () => {
  it("returns zero for the same point", () => {
    expect(approxDistanceMeters(BASE_LAT, BASE_LON, BASE_LAT, BASE_LON)).toBe(0);
  });

  it("approximates a 0.001-degree latitude step as ~110 m", () => {
    const meters = approxDistanceMeters(BASE_LAT, BASE_LON, BASE_LAT + 0.001, BASE_LON);
    expect(meters).toBeGreaterThan(105);
    expect(meters).toBeLessThan(116);
  });

  it("is symmetric to within a metre", () => {
    const a = approxDistanceMeters(BASE_LAT, BASE_LON, 41.8, -87.62);
    const b = approxDistanceMeters(41.8, -87.62, BASE_LAT, BASE_LON);
    expect(Math.abs(a - b)).toBeLessThan(1);
  });
});

describe("nearestStation", () => {
  it("picks the closest station and reports a walk estimate", () => {
    const nearest = nearestStation(BASE_LAT, BASE_LON, STATIONS);
    expect(nearest?.name).toBe("79th");
    expect(nearest?.meters).toBeLessThan(120);
    expect(nearest?.walkMinutes).toBeGreaterThanOrEqual(1);
  });

  it("returns null when no stations are available", () => {
    expect(nearestStation(BASE_LAT, BASE_LON, [])).toBeNull();
  });

  it("returns null for a non-finite origin", () => {
    expect(nearestStation(Number.NaN, BASE_LON, STATIONS)).toBeNull();
  });

  it("skips stations with non-finite coordinates", () => {
    const broken = [{ name: "Broken", system: "CTA", lat: Number.NaN, lon: BASE_LON }];
    expect(nearestStation(BASE_LAT, BASE_LON, broken)).toBeNull();
  });
});

describe("isCtaStation / isMetraStation", () => {
  it("classifies by the system prefix, case-insensitively", () => {
    expect(isCtaStation({ name: "x", system: "cta", lat: 0, lon: 0 })).toBe(true);
    expect(isCtaStation(METRA_FAR)).toBe(false);
    expect(isMetraStation({ name: "x", system: "Metra Rock Is.", lat: 0, lon: 0 })).toBe(true);
    expect(isMetraStation(CTA_NEAR)).toBe(false);
  });
});

// ── County class + implied value ─────────────────────────────────────────────

describe("impliedMarketValue", () => {
  it("grosses up commercial 5xx at the 25% assessment level (x4)", () => {
    expect(impliedMarketValue("517", 50_000)).toBe(200_000);
    expect(impliedMarketValue("522", 12_345)).toBe(49_380);
  });

  it("grosses up residential and mixed-use 2xx/3xx at 10% (x10)", () => {
    expect(impliedMarketValue("212", 20_000)).toBe(200_000);
    expect(impliedMarketValue("314", 7_500)).toBe(75_000);
  });

  it("returns null for exempt owners and county vacant-land class 100", () => {
    expect(impliedMarketValue("EX", 90_000)).toBeNull();
    expect(impliedMarketValue("100", 4_000)).toBeNull();
  });

  it("returns null when the class or value is missing or non-positive", () => {
    expect(impliedMarketValue(null, 50_000)).toBeNull();
    expect(impliedMarketValue("517", null)).toBeNull();
    expect(impliedMarketValue("517", 0)).toBeNull();
    expect(impliedMarketValue("517", Number.NaN)).toBeNull();
  });

  it("returns null for a class family it cannot convert", () => {
    expect(impliedMarketValue("900", 50_000)).toBeNull();
  });

  it("carries the screening-ballpark caption", () => {
    expect(IMPLIED_VALUE_CAPTION).toBe("screening ballpark, not an appraisal");
  });
});

describe("countyClassGloss", () => {
  it("glosses the classes this workflow meets", () => {
    expect(countyClassGloss("517")).toBe("One-story commercial building");
    expect(countyClassGloss("212")).toBe(
      "Mixed-use storefront with apartments (6 units or fewer)",
    );
  });

  it("falls back to a literal class label, never a guess", () => {
    expect(countyClassGloss("790")).toBe("County class 790");
  });

  it("returns null with no class", () => {
    expect(countyClassGloss(null)).toBeNull();
  });
});

describe("accessibilityNoteFor", () => {
  it("calls single-story commercial classes the strongest at-grade layout", () => {
    for (const cls of ["517", "522", "511"]) {
      expect(accessibilityNoteFor(cls)?.level).toBe("at-grade");
    }
  });

  it("calls 212 ground-floor usable", () => {
    expect(accessibilityNoteFor("212")?.level).toBe("ground-floor");
  });

  it("warns about stairs on 3xx walk-ups", () => {
    expect(accessibilityNoteFor("314")?.level).toBe("stairs");
    expect(accessibilityNoteFor("313")?.text).toContain("stairs");
  });

  it("asks for verification on anything else, and returns null with no class", () => {
    expect(accessibilityNoteFor("EX")?.level).toBe("verify");
    expect(accessibilityNoteFor(null)).toBeNull();
  });
});

// ── Owner axes ───────────────────────────────────────────────────────────────

describe("ownerAxesLabel", () => {
  it("reports ownership as unverified, never as privately held", () => {
    const label = ownerAxesLabel("corporate_llc", "out_of_state");
    expect(label).toBe("Corporate / LLC · out-of-state mailing address (unverified)");
    expect(label).not.toMatch(/privately held/i);
  });

  it("humanizes an unmapped axis value rather than dropping it", () => {
    expect(ownerAxesLabel("some_new_axis", "elsewhere")).toBe(
      "Some new axis · elsewhere (unverified)",
    );
  });
});

// ── Card flags ───────────────────────────────────────────────────────────────

describe("card flag copy routes to the owning authority", () => {
  it("routes vacant-building violations to the Department of Buildings", () => {
    expect(VIOLATION_FLAG).toContain("Department of Buildings");
    expect(VIOLATION_FLAG).not.toMatch(/Zoning Board|BACP/);
    expect(CONDITION_VERIFICATION_NOTE).toContain("Department of Buildings");
  });

  it("routes business licensing to BACP and never asserts occupancy", () => {
    const flag = activeLicenseFlag("Chatham Cafe");
    expect(flag).toContain("BACP");
    expect(flag).toContain("may be occupied");
    expect(flag).toContain("confirm before outreach");
    expect(flag).not.toMatch(/is occupied/);
  });

  it("frames a tax sale as leverage, not a listing", () => {
    const flag = taxSaleFlag(2019);
    expect(flag).toContain("2019");
    expect(flag).toContain("possible acquisition leverage");
    expect(flag).not.toMatch(/available|for sale/i);
  });
});

// ── Incentive-snapshot link ─────────────────────────────────────────────────

describe("shortlistSnapshotHref", () => {
  it("builds an instant-mode /report link with the record's coordinates", () => {
    expect(
      shortlistSnapshotHref({ lat: 41.75, lon: -87.605, address: "8000 S COTTAGE GROVE AVE" }),
    ).toBe(
      "/report?instant=true&lat=41.75000&lon=-87.60500&addr=8000+S+COTTAGE+GROVE+AVE&src=site_shortlist",
    );
  });

  it("uses `addr`, the parameter /report actually reads — never `address`", () => {
    // app/report/page.tsx reads searchParams.get("addr"). An `address` param
    // would leave the wizard with an empty address and no error to notice.
    const href = shortlistSnapshotHref({ lat: 41.7, lon: -87.6, address: "1 N State St" });
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("addr")).toBe("1 N State St");
    expect(params.has("address")).toBe(false);
  });

  it("encodes addresses containing separators", () => {
    const href = shortlistSnapshotHref({
      lat: 41.7,
      lon: -87.6,
      address: "100 W 63rd St, Chicago, IL & Co",
    });
    expect(href).not.toMatch(/\s/);
    expect(new URLSearchParams(href.split("?")[1]).get("addr")).toBe(
      "100 W 63rd St, Chicago, IL & Co",
    );
  });

  it("fixes coordinates to five decimals so the URL stays cache-bucketable", () => {
    const params = new URLSearchParams(
      shortlistSnapshotHref({ lat: 41.7368312345, lon: -87.5777612345, address: "x" }).split("?")[1],
    );
    expect(params.get("lat")).toBe("41.73683");
    expect(params.get("lon")).toBe("-87.57776");
  });

  it("stamps the registered attribution source", () => {
    expect(SHORTLIST_SNAPSHOT_SOURCE).toBe("site_shortlist");
    expect(shortlistSnapshotHref({ lat: 41.7, lon: -87.6, address: "x" })).toContain(
      "src=site_shortlist",
    );
  });

  it("is registered in /report's source allowlist, so attribution is not silently dropped", () => {
    // cleanReportSource() collapses any unlisted src into the generic
    // instant_report bucket. This guard is the only thing that would catch the
    // allowlist and the constant drifting apart.
    const source = readFileSync(path.join(process.cwd(), "app/report/page.tsx"), "utf8");
    const allowlist = source.slice(
      source.indexOf("const ALLOWED_REPORT_SOURCES"),
      source.indexOf("function cleanReportSource"),
    );
    expect(allowlist).toContain(`"${SHORTLIST_SNAPSHOT_SOURCE}"`);
  });
});
