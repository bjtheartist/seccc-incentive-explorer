import { describe, expect, it } from "vitest";

import { buildZoningHandoff } from "../stage-handoff";

describe("buildZoningHandoff", () => {
  it("builds a compact package with all fields present", () => {
    const handoff = buildZoningHandoff({
      address: "8701 S Commercial Ave",
      businessType: "Cafe",
      zoneClass: "B3-2",
      activityLabel: "Restaurant or cafe",
      reviewAnswers: [
        { question: "Will there be seating?", answer: "Yes" },
        { question: "Alcohol service?", answer: "No alcohol" },
      ],
      officialLinks: [
        { label: "District use table", url: "https://example.gov/use-table" },
      ],
      reportUrl: "https://chicagoincentiveexplorer.com/report?x=1",
    });

    expect(handoff.subject).toBe("Zoning question — Cafe at 8701 S Commercial Ave");
    expect(handoff.body).toContain("Address: 8701 S Commercial Ave");
    expect(handoff.body).toContain("Business: Cafe");
    expect(handoff.body).toContain("Published zoning designation: B3-2");
    expect(handoff.body).toContain('whether "Restaurant or cafe" can operate');
    expect(handoff.body).toContain("- Will there be seating? Yes");
    expect(handoff.body).toContain("- District use table: https://example.gov/use-table");
    expect(handoff.body).toContain("Full site report (optional context):");
  });

  it("reads as an open question, never a determination", () => {
    const handoff = buildZoningHandoff({
      address: "123 W Test St",
      businessType: "Daycare",
      zoneClass: "RS-3",
      activityLabel: "Child or adult day care",
    });

    // The words that would turn a handoff into a conclusion must not appear.
    const lower = handoff.body.toLowerCase();
    expect(lower).not.toMatch(/is (allowed|permitted|prohibited)\b/);
    expect(lower).not.toContain("eligible for");
    expect(lower).not.toContain("qualifies");
    // And the boundary is stated affirmatively, twice (question + footer).
    expect(handoff.body).toContain("The Explorer does not determine this");
    expect(handoff.body).toContain("does not determine eligibility or use permissions");
  });

  it("handles missing data honestly rather than inventing it", () => {
    const handoff = buildZoningHandoff({});

    expect(handoff.body).toContain("Address: Not provided");
    expect(handoff.body).toContain("Business: Not provided");
    expect(handoff.body).toContain(
      "Published zoning designation: Not published for this location",
    );
    // No empty scaffolding for absent sections.
    expect(handoff.body).not.toContain("Details the user provided");
    expect(handoff.body).not.toContain("Official sources:");
    expect(handoff.body).not.toContain("Full site report");
  });

  it("drops blank answers and links instead of rendering stubs", () => {
    const handoff = buildZoningHandoff({
      address: "1 N Test",
      reviewAnswers: [
        { question: "  ", answer: "Yes" },
        { question: "Seating?", answer: "  " },
      ],
      officialLinks: [{ label: "", url: "https://example.gov" }],
    });

    expect(handoff.body).not.toContain("Details the user provided");
    expect(handoff.body).not.toContain("Official sources:");
  });

  it("keeps the subject usable when only the address is known", () => {
    const handoff = buildZoningHandoff({ address: "456 E Test Ave" });
    expect(handoff.subject).toBe("Zoning question — 456 E Test Ave");
  });

  it("stays under a forwardable length with realistic input", () => {
    const handoff = buildZoningHandoff({
      address: "8701 S Commercial Ave",
      businessType: "Community fresh market and cafe",
      zoneClass: "B3-2",
      activityLabel: "Grocery or fresh market",
      reviewAnswers: Array.from({ length: 6 }, (_, i) => ({
        question: `Question ${i + 1}?`,
        answer: "A realistic short answer",
      })),
      officialLinks: [
        { label: "District use table", url: "https://example.gov/a" },
        { label: "Zoning layer", url: "https://example.gov/b" },
        { label: "ZBA", url: "https://example.gov/c" },
      ],
      reportUrl: "https://chicagoincentiveexplorer.com/report?long=params",
    });

    // A navigator should read this in under thirty seconds.
    expect(handoff.body.length).toBeLessThan(1800);
    expect(handoff.body.split("\n").length).toBeLessThan(35);
  });
});
