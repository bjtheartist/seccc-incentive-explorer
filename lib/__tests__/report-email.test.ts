import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deliverReportByEmail,
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

  it("posts the generated PDF with identity, goal, and consent fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await deliverReportByEmail({
      report: fixture(),
      email: " Owner@Example.com ",
      name: "Taylor",
      wantsHelp: true,
      projectType: "hiring",
      projectGoals: ["hiring", "equipment", "other"],
      customGoal: "Open a shared commercial kitchen",
      source: "report_email_gate",
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      email: "owner@example.com",
      name: "Taylor",
      wantsHelp: true,
      projectGoal: "Hire or retain employees, Buy equipment, Open a shared commercial kitchen",
      projectType: "hiring",
      projectGoals: ["hiring", "equipment", "other"],
      customGoal: "Open a shared commercial kitchen",
      zipCode: "60632",
      incentiveCount: 1,
    });
    expect(body.pdfBase64).toMatch(/^JVBER/);
    expect(JSON.stringify(body)).not.toContain('"score"');
  });
});
