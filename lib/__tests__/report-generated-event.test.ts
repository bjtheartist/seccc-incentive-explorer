import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { GeneratedReport } from "@/lib/report-engine";
import {
  createGeneratedReportEventGate,
  generatedReportEventKey,
  generatedReportEventType,
} from "@/lib/report-generated-event";

function reportFixture(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    title: "Location Snapshot",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-07-10T12:00:00.000Z",
    summary: "",
    sections: [],
    recommendedActions: [],
    metadata: { address: "9101 S Commercial Ave" },
    ...overrides,
  };
}

function keyFor(
  report: GeneratedReport,
  isInstantMode: boolean,
  hasRefinedInstantReport: boolean,
  source: string,
) {
  return generatedReportEventKey(
    report,
    generatedReportEventType(report, isInstantMode, hasRefinedInstantReport),
    source,
  );
}

describe("generatedReportEventType", () => {
  it("classifies an unrefined instant report as a location snapshot", () => {
    expect(generatedReportEventType(reportFixture(), true, false)).toBe(
      "location_snapshot_generated",
    );
  });

  it("classifies refined and wizard reports as refined reports", () => {
    expect(generatedReportEventType(reportFixture(), true, true)).toBe(
      "refined_report_generated",
    );
    expect(generatedReportEventType(reportFixture(), false, false)).toBe(
      "refined_report_generated",
    );
  });

  it("classifies vacancy report types as vacancy reports", () => {
    expect(
      generatedReportEventType(reportFixture({ reportType: "dev-feasibility" }), false, false),
    ).toBe("vacancy_report_generated");
  });
});

// ─── Single-fire guarantee (7/10 double-fire fix) ─────────────────────
// location_snapshot_generated used to fire twice per instant snapshot:
// once from the generated-report effect and once inline from the instant
// generation effect. The gate below (keyed by report identity, not a
// debounce) is what guarantees exactly one event per generated snapshot.

describe("generated-report event gate", () => {
  it("fires exactly once per generated snapshot, however often the effect re-runs", () => {
    const gate = createGeneratedReportEventGate();
    const key = keyFor(reportFixture(), true, false, "homepage");

    const fires = [key, key, key, key].filter((k) => gate.shouldFire(k));
    expect(fires).toHaveLength(1);
  });

  it("fires again for a different report identity (new generation)", () => {
    const gate = createGeneratedReportEventGate();
    const first = reportFixture();
    const second = reportFixture({
      generatedAt: "2026-07-10T12:05:00.000Z",
      metadata: { address: "2100 E 87th St" },
    });

    expect(gate.shouldFire(keyFor(first, true, false, "homepage"))).toBe(true);
    expect(gate.shouldFire(keyFor(second, true, false, "homepage"))).toBe(true);
  });

  it("fires the refined event when the same flow refines the snapshot", () => {
    const gate = createGeneratedReportEventGate();
    const snapshot = reportFixture();
    const refined = reportFixture({ generatedAt: "2026-07-10T12:06:00.000Z" });

    expect(gate.shouldFire(keyFor(snapshot, true, false, "homepage"))).toBe(true);
    // Refining produces a different event type -> different key -> one fire.
    expect(gate.shouldFire(keyFor(refined, true, true, "homepage"))).toBe(true);
    expect(gate.shouldFire(keyFor(refined, true, true, "homepage"))).toBe(false);
  });
});

// ─── Source regression: one emitter only ──────────────────────────────
// The report page must route every generated-report funnel event through
// the gated effect. A second inline trackEvent call for these event types
// is exactly the bug this guards against.

describe("report page has a single generated-report event emitter", () => {
  const pageSource = readFileSync(
    join(process.cwd(), "app/report/page.tsx"),
    "utf8",
  );

  it("never calls trackEvent with a generated-report event literal", () => {
    expect(pageSource).not.toContain('trackEvent("location_snapshot_generated"');
    expect(pageSource).not.toContain('trackEvent("refined_report_generated"');
    expect(pageSource).not.toContain('trackEvent("vacancy_report_generated"');
  });

  it("routes emission through the identity-keyed gate", () => {
    expect(pageSource).toContain("createGeneratedReportEventGate");
    expect(pageSource).toContain("generatedReportEventKey(report, eventType, reportSource)");
  });
});
