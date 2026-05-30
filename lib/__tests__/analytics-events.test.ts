import { describe, expect, it } from "vitest";
import {
  sanitizeAnalyticsEventPayload,
  isAnalyticsEventType,
} from "../analytics-events";

describe("analytics events", () => {
  it("accepts known product events", () => {
    expect(isAnalyticsEventType("location_snapshot_generated")).toBe(true);
    expect(isAnalyticsEventType("not_real")).toBe(false);
  });

  it("sanitizes event payloads before storing", () => {
    const event = sanitizeAnalyticsEventPayload("refined_report_generated", {
      reportType: "site-incentives",
      source: "wizard",
      address: "  1207 W 63rd St  ",
      lat: 41.779444,
      lon: -87.654897,
      metadata: {
        zoneCount: 7,
        labels: ["ssa", "tif"],
        nested: { skip: true },
      } as never,
    });

    expect(event).toMatchObject({
      eventType: "refined_report_generated",
      reportType: "site-incentives",
      source: "wizard",
      address: "1207 W 63rd St",
      lat: 41.779444,
      lon: -87.654897,
      metadata: {
        zoneCount: 7,
        labels: ["ssa", "tif"],
      },
    });
    expect(event?.metadata).not.toHaveProperty("nested");
  });

  it("rejects unknown events", () => {
    expect(sanitizeAnalyticsEventPayload("whatever", {})).toBeNull();
  });
});
