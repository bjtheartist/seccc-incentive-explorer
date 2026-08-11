import { describe, it, expect } from "vitest";
import type { GeneratedReport } from "@/lib/report-engine";
import {
  CURRENT_REPORT_SCHEMA_VERSION,
  normalizeSavedReport,
  stampReportSchemaVersion,
} from "@/lib/report-schema";

/** A minimal but real current-shape report, as the save route would store it. */
function currentReport(overrides: Partial<GeneratedReport> = {}): Record<string, unknown> {
  return {
    schemaVersion: CURRENT_REPORT_SCHEMA_VERSION,
    title: "Incentive Report",
    subtitle: "1234 S Halsted St",
    reportType: "site-incentives",
    generatedAt: "2026-08-11T00:00:00.000Z",
    summary: "Two programs are mapped at this address.",
    sections: [
      {
        title: "Programs Mapped at This Address",
        items: [{ label: "SBIF", value: "Up to $150,000" }],
      },
    ],
    recommendedActions: [
      { label: "Call the ward office", description: "Confirm corridor status.", priority: "high" },
    ],
    metadata: { address: "1234 S Halsted St", lat: 41.86, lon: -87.64 },
    ...overrides,
  } as Record<string, unknown>;
}

/** The same report as it would have been saved before schemaVersion existed. */
function legacyReport(): Record<string, unknown> {
  const report = currentReport();
  delete report.schemaVersion;
  return report;
}

describe("normalizeSavedReport — current reports", () => {
  it("accepts a current-version report and preserves its content", () => {
    const result = normalizeSavedReport(currentReport());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceVersion).toBe(CURRENT_REPORT_SCHEMA_VERSION);
    expect(result.migrated).toBe(false);
    expect(result.report.title).toBe("Incentive Report");
    expect(result.report.sections[0].items[0].label).toBe("SBIF");
    expect(result.report.recommendedActions[0].priority).toBe("high");
    expect(result.report.metadata.address).toBe("1234 S Halsted St");
  });

  it("carries through optional fields the boundary does not name", () => {
    const result = normalizeSavedReport(
      currentReport({
        verdict: { headline: "Strong fit", subheadline: "Two programs", topReasons: ["SBIF"] },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.verdict?.headline).toBe("Strong fit");
  });

  /**
   * `startHere` (lib/start-here.ts) is a purely additive optional field —
   * it was not part of any schema version and does not bump
   * CURRENT_REPORT_SCHEMA_VERSION. This pins both halves of that claim: a
   * blob that carries it round-trips it untouched, and a blob saved before
   * it existed (the common case — every row in prod today) normalizes fine
   * with it simply absent, not as an error or a fabricated default.
   */
  it("passes a present startHere field through untouched", () => {
    const startHere = {
      primary: { label: "Call Test Agency about TIF Program", description: "…", kind: "call-agency" as const },
      secondary: [],
      evidence: [],
      unresolvedQuestions: [],
      audience: "site-incentives",
    };
    const result = normalizeSavedReport(currentReport({ startHere }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.startHere).toEqual(startHere);
  });

  it("tolerates a report saved before startHere existed (the common case)", () => {
    const result = normalizeSavedReport(currentReport());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.startHere).toBeUndefined();
  });

  it("always stamps the current version on the returned report", () => {
    const result = normalizeSavedReport(legacyReport());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.schemaVersion).toBe(CURRENT_REPORT_SCHEMA_VERSION);
  });
});

describe("normalizeSavedReport — version-less legacy blobs", () => {
  it("treats a missing schemaVersion as version 1 rather than a failure", () => {
    const result = normalizeSavedReport(legacyReport());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceVersion).toBe(1);
    expect(result.report.sections).toHaveLength(1);
  });

  it("accepts an explicit null schemaVersion as legacy", () => {
    const result = normalizeSavedReport({ ...legacyReport(), schemaVersion: null });
    expect(result.ok).toBe(true);
  });

  it("fills defaults for recoverable fields an old blob never wrote", () => {
    const blob = legacyReport();
    delete blob.summary;
    delete blob.subtitle;
    delete blob.generatedAt;
    delete blob.metadata;

    const result = normalizeSavedReport(blob);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.summary).toBe("");
    expect(result.report.subtitle).toBe("");
    expect(result.report.generatedAt).toBe("");
    expect(result.report.metadata).toEqual({});
  });

  it("falls back to site-incentives for an unrecognized reportType", () => {
    const result = normalizeSavedReport({ ...legacyReport(), reportType: "some-retired-type" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.reportType).toBe("site-incentives");
  });

  it("keeps a legacy report type the engine still declares", () => {
    const result = normalizeSavedReport({ ...legacyReport(), reportType: "location-incentives" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.reportType).toBe("location-incentives");
  });

  it("coerces a section with no items array into an empty item list", () => {
    const result = normalizeSavedReport({
      ...legacyReport(),
      sections: [{ title: "Legacy Section" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.sections[0].items).toEqual([]);
  });

  it("drops non-object section and action entries instead of handing them to the renderer", () => {
    const result = normalizeSavedReport({
      ...legacyReport(),
      sections: [null, "broken", { title: "Real", items: [] }],
      recommendedActions: [42, { label: "Real action", description: "", priority: "medium" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.sections).toHaveLength(1);
    expect(result.report.sections[0].title).toBe("Real");
    expect(result.report.recommendedActions).toHaveLength(1);
  });

  it("normalizes an unknown action priority to low rather than passing it through", () => {
    const result = normalizeSavedReport({
      ...legacyReport(),
      recommendedActions: [{ label: "A", description: "B", priority: "urgent" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.recommendedActions[0].priority).toBe("low");
  });
});

describe("normalizeSavedReport — safe failure", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not a report"],
    ["a number", 7],
    ["an array", [{ title: "x" }]],
  ])("fails on %s without throwing", (_label, value) => {
    const result = normalizeSavedReport(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-an-object");
  });

  it("fails on an empty object", () => {
    const result = normalizeSavedReport({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-required-fields");
    expect(result.detail).toContain("title");
    expect(result.detail).toContain("sections");
  });

  it("fails when sections is not an array", () => {
    const result = normalizeSavedReport({ ...legacyReport(), sections: { title: "nope" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-required-fields");
    expect(result.detail).toContain("sections");
  });

  it("fails when the title is blank", () => {
    const result = normalizeSavedReport({ ...legacyReport(), title: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-required-fields");
  });

  it("fails on a report written by a newer deploy instead of guessing at it", () => {
    const result = normalizeSavedReport({
      ...currentReport(),
      schemaVersion: CURRENT_REPORT_SCHEMA_VERSION + 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("future-version");
    expect(result.detail).toContain(String(CURRENT_REPORT_SCHEMA_VERSION + 1));
  });

  it.each([["a string", "1"], ["a fraction", 1.5], ["zero", 0], ["negative", -3]])(
    "fails when schemaVersion is %s",
    (_label, version) => {
      const result = normalizeSavedReport({ ...currentReport(), schemaVersion: version });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid-version");
    },
  );

  it("never throws on deeply malformed input", () => {
    const garbage = {
      schemaVersion: 1,
      title: "Garbage",
      sections: [{ title: 99, items: [null, 5, { label: {}, value: [] }] }],
      recommendedActions: [],
      metadata: "not an object",
    };

    expect(() => normalizeSavedReport(garbage)).not.toThrow();
    const result = normalizeSavedReport(garbage);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.sections[0].title).toBe("");
    expect(result.report.sections[0].items).toHaveLength(1);
    expect(result.report.sections[0].items[0].label).toBe("");
    expect(result.report.metadata).toEqual({});
  });
});

describe("stampReportSchemaVersion", () => {
  it("writes the current version onto a report about to be saved", () => {
    const stamped = stampReportSchemaVersion({ title: "x" });
    expect(stamped.schemaVersion).toBe(CURRENT_REPORT_SCHEMA_VERSION);
    expect(stamped.title).toBe("x");
  });

  it("overwrites a stale version supplied by the client", () => {
    const stamped = stampReportSchemaVersion({ title: "x", schemaVersion: 0 });
    expect(stamped.schemaVersion).toBe(CURRENT_REPORT_SCHEMA_VERSION);
  });

  it("round-trips through normalizeSavedReport", () => {
    const stamped = stampReportSchemaVersion(legacyReport());
    const result = normalizeSavedReport(stamped);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceVersion).toBe(CURRENT_REPORT_SCHEMA_VERSION);
    expect(result.migrated).toBe(false);
  });
});
