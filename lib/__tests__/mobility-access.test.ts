import { describe, expect, it } from "vitest";
import { describeMobilityAccess, parseCsv } from "../mobility-access";

describe("mobility access helpers", () => {
  it("parses GTFS-style CSV rows with quoted commas", () => {
    const rows = parseCsv([
      "stop_id,stop_name,stop_lat,stop_lon,location_type",
      "40010,\"Austin (Blue)\",41.870851,-87.776812,1",
      "40020,\"Harlem/Lake, Oak Park\",41.886848,-87.803176,1",
    ].join("\n"));

    expect(rows).toEqual([
      {
        stop_id: "40010",
        stop_name: "Austin (Blue)",
        stop_lat: "41.870851",
        stop_lon: "-87.776812",
        location_type: "1",
      },
      {
        stop_id: "40020",
        stop_name: "Harlem/Lake, Oak Park",
        stop_lat: "41.886848",
        stop_lon: "-87.803176",
        location_type: "1",
      },
    ]);
  });

  it("summarizes public-source mobility access without numeric scoring", () => {
    const lines = describeMobilityAccess({
      transitLabel: "Strong public transit access",
      bikeLabel: "Nearby bike access",
      driveLabel: "Good drive access",
      freightLabel: "Freight rail nearby",
      ctaRailStations: [
        {
          name: "79th",
          category: "cta_rail",
          agency: "CTA",
          miles: 0.2,
          lat: 41.7504,
          lon: -87.6251,
          sourceId: "cta-gtfs",
        },
      ],
      metraStations: [],
      busStops: [
        {
          name: "79th Red Line Station",
          category: "bus_stop",
          agency: "CTA",
          miles: 0.1,
          lat: 41.7508,
          lon: -87.625,
          routes: ["75", "79"],
          sourceId: "cta-bus-stops",
        },
      ],
      bikeRoutes: [
        {
          name: "STATE ST - 79TH ST to 75TH ST",
          category: "bike_route",
          miles: 0.1,
          routeType: "Buffered Bike Lane",
          sourceId: "city-bike-routes",
        },
      ],
      airports: [],
      expressways: [],
      freightRail: [],
      sources: [],
      caveats: [],
      refreshedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(lines.join("\n")).toContain("CTA rail: 79th");
    expect(lines.join("\n")).toContain("CTA bus: 79th Red Line Station routes 75, 79");
    expect(lines.join("\n")).not.toContain("/100");
  });
});
