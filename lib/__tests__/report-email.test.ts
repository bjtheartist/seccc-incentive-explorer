import { afterEach, describe, expect, it, vi } from "vitest";
import {
  programCount,
  reportEmailGateKey,
  reportRequiresEmailGate,
} from "../report-email";
import type { GeneratedReport } from "../report-engine";

function fixture(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    title: "Site Incentive Analysis",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-07-10T12:00:00.000Z",
    summary: "A focused report.",
    sections: [
      {
        title: "Programs to Review for Your Goal",
        items: [
          {
            label: "EDGE",
            value: "Contact for details",
            programId: "edge",
            projectFit: {
              level: "strong",
              label: "Directly related to hiring",
              reason: "Directly supports the selected goal.",
            },
          },
        ],
      },
    ],
    recommendedActions: [],
    metadata: {
      address: "4200 S California Ave, Chicago, IL 60632",
      lat: 41.8169,
      lon: -87.6949,
      projectType: "hiring",
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("report email client", () => {
  it("gates incentive reports but not corridor intelligence", () => {
    expect(reportRequiresEmailGate(fixture())).toBe(true);
    expect(reportRequiresEmailGate(fixture({ reportType: "corridor-intelligence" }))).toBe(false);
  });

  it("uses a stable location key instead of generation time", () => {
    expect(reportEmailGateKey(fixture())).toBe(
      reportEmailGateKey(fixture({ generatedAt: "2026-07-11T12:00:00.000Z" })),
    );
  });

});

/**
 * build-spec.md 2.4 (audit F14): programCount must count distinct
 * programIds, never the number of narrative sections — the exact bug the
 * shared-modal refactor introduced by wiring report.sections.length in.
 */
describe("programCount", () => {
  it("counts distinct programIds, not sections.length, when a report has more sections than unique programs", () => {
    const report = fixture({
      sections: [
        {
          title: "Overview",
          items: [{ label: "Community Area", value: "South Chicago" }],
        },
        {
          title: "Programs to Review",
          items: [
            { label: "EDGE", value: "x", programId: "edge" },
            { label: "TIF", value: "x", programId: "tif" },
          ],
        },
        {
          title: "Also Worth Reviewing",
          items: [{ label: "EDGE (again)", value: "x", programId: "edge" }],
        },
      ],
    });
    expect(report.sections.length).toBe(3);
    expect(programCount(report)).toBe(2);
    expect(programCount(report)).not.toBe(report.sections.length);
  });

  it("returns 0 for a report with sections but no programId items, never the section count", () => {
    const report = fixture({
      sections: [
        { title: "A", items: [{ label: "x", value: "y" }] },
        { title: "B", items: [{ label: "x", value: "y" }] },
      ],
    });
    expect(programCount(report)).toBe(0);
  });
});
