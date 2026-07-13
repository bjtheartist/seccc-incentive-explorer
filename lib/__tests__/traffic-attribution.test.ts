import { describe, expect, it } from "vitest";
import { readTrafficAttribution } from "@/lib/traffic-attribution";

describe("readTrafficAttribution", () => {
  it("captures campaign fields and strips referrer query data", () => {
    expect(
      readTrafficAttribution(
        "?utm_source=cclf&utm_medium=partner&utm_campaign=cdfi-pilot&utm_content=lending-team",
        "https://example.org/resources?email=person%40example.org#private",
      ),
    ).toEqual({
      utmSource: "cclf",
      utmMedium: "partner",
      utmCampaign: "cdfi-pilot",
      utmContent: "lending-team",
      referrerHost: "example.org",
      referrerPath: "/resources",
    });
  });

  it("omits empty and invalid attribution values", () => {
    expect(readTrafficAttribution("?utm_source=", "not a url")).toEqual({});
  });

  it("bounds user-supplied campaign metadata", () => {
    const attribution = readTrafficAttribution(
      `?utm_campaign=${"x".repeat(200)}`,
    );

    expect(attribution.utmCampaign).toHaveLength(120);
  });
});
