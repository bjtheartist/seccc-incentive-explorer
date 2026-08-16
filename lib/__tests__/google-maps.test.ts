import { describe, expect, it } from "vitest";
import { googleMapsSearchUrl } from "../google-maps";

describe("googleMapsSearchUrl", () => {
  it("encodes a Chicago address and ZIP without corrupting punctuation", () => {
    const url = googleMapsSearchUrl({ address: "1200 O'Brien #2 & Annex", zip: "60623" });
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.origin).toBe("https://www.google.com");
    expect(parsed.searchParams.get("api")).toBe("1");
    expect(parsed.searchParams.get("query")).toBe("1200 O'Brien #2 & Annex, Chicago, IL 60623");
  });

  it("does not append Chicago twice", () => {
    const url = new URL(googleMapsSearchUrl({ address: "3040 S HOMAN AVE, CHICAGO, IL 60623" })!);
    expect(url.searchParams.get("query")).toBe("3040 S HOMAN AVE, CHICAGO, IL 60623");
  });

  it("falls back to six-decimal coordinates for a placeholder address", () => {
    const url = new URL(googleMapsSearchUrl({ address: "Address not published", lat: 41.83776, lon: -87.70998 })!);
    expect(url.searchParams.get("query")).toBe("41.837760,-87.709980");
  });

  it.each(["N/A", "Address unknown", "Not published"])(
    "treats %s as a placeholder instead of a destination",
    (address) => {
      const url = new URL(googleMapsSearchUrl({ address, lat: 41.83776, lon: -87.70998 })!);
      expect(url.searchParams.get("query")).toBe("41.837760,-87.709980");
    },
  );

  it("rejects finite coordinates outside latitude/longitude ranges", () => {
    expect(googleMapsSearchUrl({ address: "N/A", lat: 999, lon: 999 })).toBeNull();
    expect(googleMapsSearchUrl({ address: "Unknown", lat: -91, lon: -87.7 })).toBeNull();
    expect(googleMapsSearchUrl({ address: "Unknown", lat: 41.8, lon: 181 })).toBeNull();
  });

  it("omits a link when neither address nor coordinates are usable", () => {
    expect(googleMapsSearchUrl({ address: "Unknown", lat: 0, lon: Number.NaN })).toBeNull();
  });
});
