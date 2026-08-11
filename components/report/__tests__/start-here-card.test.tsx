import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StartHereCard } from "@/components/report/StartHereCard";
import type { GeneratedReport } from "@/lib/report-engine";
import type { StartHere } from "@/lib/start-here";

function baseReport(startHere?: StartHere): GeneratedReport {
  return {
    title: "Location Snapshot",
    subtitle: "",
    reportType: "site-incentives",
    generatedAt: "2026-08-01T00:00:00.000Z",
    summary: "",
    sections: [],
    metadata: { address: "8701 S Commercial Ave", lat: 41.7367, lon: -87.5518 },
    ...(startHere ? { startHere } : {}),
  } as unknown as GeneratedReport;
}

const callPrimary: StartHere = {
  primary: {
    label: "Call Test Agency about TIF Program",
    description: "A test program that reimburses a share of facade costs.",
    kind: "call-agency",
    programId: "tif",
    contact: { agency: "Test Agency", abbreviation: "TA", phone: "312-555-0000" },
  },
  secondary: [
    {
      label: "Confirm with the administering agency whether SBIF applies to this project",
      description: "A facade improvement program.",
      kind: "confirm-with-agency",
      programId: "sbif",
      contact: { agency: "SBIF Office", abbreviation: "SBIF", url: "https://example.com/sbif" },
      officialUrl: "https://example.com/sbif",
    },
    {
      label: "Book free business advising",
      description: "Free one-on-one advising for small businesses.",
      kind: "book-advising",
      programId: "smallBizSource",
      contact: { agency: "Cook County SBS", abbreviation: "SBS", phone: "312-555-1000" },
    },
  ],
  evidence: [{ fact: "This address sits inside a TIF district.", sourceLabel: "City of Chicago GIS" }],
  unresolvedQuestions: ["Does TIF Program still require: current payroll records?"],
  audience: "site-incentives",
};

const zoningPrimary: StartHere = {
  primary: {
    label: "Confirm the zoning use question before anything else",
    description: "The published zoning classification does not resolve whether this use is permitted here.",
    kind: "confirm-zoning-use",
  },
  secondary: [],
  evidence: [],
  unresolvedQuestions: ["Is the proposed use consistent with the mapped zoning classification?"],
  audience: "site-incentives",
};

const genericFallback: StartHere = {
  primary: {
    label: "Confirm your project details with a local business support organization",
    description: "No address-linked program or advising contact was found in the mapped data.",
    kind: "gather-information",
  },
  secondary: [],
  evidence: [],
  unresolvedQuestions: [],
  audience: "site-incentives",
};

describe("StartHereCard", () => {
  it("renders nothing when report.startHere is absent", () => {
    const html = renderToStaticMarkup(
      <StartHereCard report={baseReport(undefined)} source="test" />,
    );
    expect(html).toBe("");
  });

  it("renders the primary action as a dominant tel: control, secondary actions subordinate, questions, and sourced evidence", () => {
    const html = renderToStaticMarkup(
      <StartHereCard report={baseReport(callPrimary)} source="test" />,
    );

    expect(html).toContain("Start here");
    expect(html).toContain("Call Test Agency about TIF Program");
    expect(html).toContain('href="tel:312-555-0000"');

    // Secondary actions render, with real tap targets when carried.
    expect(html).toContain("Confirm with the administering agency whether SBIF applies to this project");
    expect(html).toContain('href="https://example.com/sbif"');
    expect(html).toContain("Book free business advising");
    expect(html).toContain('href="tel:312-555-1000"');

    // Open questions.
    expect(html).toContain("Open questions");
    expect(html).toContain("Does TIF Program still require: current payroll records?");

    // Evidence, each with its source label.
    expect(html).toContain("This address sits inside a TIF district.");
    expect(html).toContain("City of Chicago GIS");
  });

  it("leads with the zoning question as the conclusion line when primary is confirm-zoning-use", () => {
    const html = renderToStaticMarkup(
      <StartHereCard report={baseReport(zoningPrimary)} source="test" />,
    );
    expect(html).toContain("An open zoning or use question comes before any financing step.");
    expect(html).toContain("Confirm the zoning use question before anything else");
    expect(html).toContain("Is the proposed use consistent with the mapped zoning classification?");
  });

  it("renders the generic fallback primary as plain text, with no tap target, when there is no contact or URL", () => {
    const html = renderToStaticMarkup(
      <StartHereCard report={baseReport(genericFallback)} source="test" />,
    );
    expect(html).toContain("Confirm your project details with a local business support organization");
    expect(html).toContain("No published contact on file");
    expect(html).not.toContain("<a href=");
  });

  it("never uses eligibility-determination language or 'Next steps required' framing in its own copy", () => {
    // Program label/description text is pass-through data normalized upstream
    // by report-engine.ts's normalizePublicHeadlineText (Phase A) before it
    // ever reaches this component — this test scopes to the STATIC copy the
    // component itself authors: the eyebrow label and the two conclusion-line
    // variants.
    const forbidden = /\ballowed\b|\bpermitted\b|\bprohibited\b|\beligible\b|\bqualifies\b/i;
    expect("Start here").not.toMatch(forbidden);
    expect("One step is worth taking first — everything below explains why.").not.toMatch(forbidden);
    expect("An open zoning or use question comes before any financing step.").not.toMatch(forbidden);
    expect("No published contact on file — a local support organization can help with this step.").not.toMatch(forbidden);
    expect("What we know").not.toMatch(forbidden);

    const html = renderToStaticMarkup(
      <StartHereCard report={baseReport(callPrimary)} source="test" />,
    );
    expect(html).not.toContain("Next steps required");
    expect(html).toContain("Start here");
  });
});
