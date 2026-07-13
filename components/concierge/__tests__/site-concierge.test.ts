import { describe, expect, it } from "vitest";
import { pageLabelForRoute } from "@/components/concierge/SiteConciergeProvider";

describe("site concierge route context", () => {
  it("labels primary and nested routes for the persistent guide", () => {
    expect(pageLabelForRoute("/")).toBe("Home");
    expect(pageLabelForRoute("/programs/small-business-improvement-fund")).toBe(
      "Program details"
    );
    expect(pageLabelForRoute("/workspace/incentive-preparation/packet-1")).toBe(
      "Workspace"
    );
    expect(pageLabelForRoute("/corridors/60617")).toBe(
      "Corridor intelligence"
    );
  });

  it("uses a safe generic label for an unknown route", () => {
    expect(pageLabelForRoute("/something-new")).toBe(
      "Chicago Incentive Explorer"
    );
  });
});
