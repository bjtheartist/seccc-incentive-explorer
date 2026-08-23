// @vitest-environment jsdom
//
// Gate review round 1 rewrote this file from renderToStaticMarkup to real
// @testing-library/react interactions. The reviewer's falsification pass
// proved the ORIGINAL suite (all renderToStaticMarkup) structurally blind
// to: the enable transition (F5 — injecting `canProceed = false` still
// passed 16/16), the entire support-submit path (F7 — `if (true) return;`
// as maybeSubmitSupportRequest's first line still passed 16/16),
// exclusivity + the 2-chip cap (F4/F9 — both mutants passed), and
// self-referential board-copy assertions (F6 — the old test compared the
// render to the SAME constant it renders from, so a relabeled chip still
// passed). Every test below either clicks something real and asserts on
// the resulting DOM/mock-call state, or hardcodes literal board copy
// instead of importing it from the source it's meant to pin.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportEmailGate } from "@/components/report/ReportEmailGate";
import type { GeneratedReport } from "@/lib/report-engine";
import { trackEvent } from "@/lib/analytics-events";
import { submitSupportRequest } from "@/lib/support-lead";

const { authState } = vi.hoisted(() => ({
  authState: { status: "unauthenticated" as "authenticated" | "unauthenticated" },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: authState.status, data: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/analytics-events", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/lib/support-lead", () => ({
  submitSupportRequest: vi.fn(),
}));

const trackEventMock = vi.mocked(trackEvent);
const submitSupportRequestMock = vi.mocked(submitSupportRequest);

const baseReport: GeneratedReport = {
  title: "Site Incentive Analysis",
  subtitle: "",
  reportType: "site-incentives",
  generatedAt: "2026-07-10T12:00:00.000Z",
  summary: "",
  sections: [],
  recommendedActions: [],
  metadata: {
    address: "4200 S California Ave, Chicago, IL",
  },
};

// Exact, HARD-CODED literal copy pulled straight from R6GateBlessed.dc.html
// (gate review round 1, MAJOR finding 6 — the F6 falsification: the old
// test compared render output to `GATE_GOAL_CHIPS[i].label`, the SAME
// constant the component renders from, so a relabeled chip in the source
// still passed. These strings are independent of the source.)
const BOARD_PERSONA_LABELS = ["Just looking", "Business owner", "Supporting businesses", "Developer"];
const BOARD_GOAL_LABELS = [
  "Renovate or build out",
  "Expand or buy equipment",
  "Open or relocate",
  "Hire or train staff",
  "Energy & building upgrades",
  "Build new",
  "Develop housing or mixed-use",
  "Just looking around",
];

function renderGate(
  overrides: Partial<{
    report: GeneratedReport;
    onPrepareReport: (goals: string[], customGoal: string) => Promise<GeneratedReport | null>;
    onReportReady: (report: GeneratedReport) => void;
  }> = {},
) {
  const onPrepareReport =
    overrides.onPrepareReport ?? vi.fn(async (_goals: string[], _customGoal: string) => baseReport);
  const onReportReady = overrides.onReportReady ?? vi.fn();
  const utils = render(
    <ReportEmailGate
      report={overrides.report ?? baseReport}
      source="test"
      onPrepareReport={onPrepareReport}
      onReportReady={onReportReady}
    />,
  );
  return { ...utils, onPrepareReport, onReportReady };
}

function viewButton() {
  return screen.getByTestId("report-email-gate-view") as HTMLButtonElement;
}

function saveButton() {
  return screen.getByTestId("report-email-gate-save") as HTMLButtonElement;
}

function goalChip(label: string) {
  return screen.getByRole("button", { name: label });
}

// Gate review round 2, MINOR NEW-8: two tests below redefine
// `window.location` via `Object.defineProperty` to mock `.assign` and
// never restored it, leaking the mock into every subsequent test in this
// file. Captured once and restored centrally after every test, whether or
// not that particular test touched it.
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, "location");

beforeEach(() => {
  authState.status = "unauthenticated";
  trackEventMock.mockClear();
  submitSupportRequestMock.mockReset();
  submitSupportRequestMock.mockResolvedValue({ success: true, notified: true });
});

afterEach(() => {
  cleanup();
  if (originalLocationDescriptor) {
    Object.defineProperty(window, "location", originalLocationDescriptor);
  }
});

describe("ReportEmailGate — fixed anatomy and literal board copy", () => {
  it("renders every board element with literal, hardcoded copy", () => {
    renderGate();

    expect(screen.getByText("Chicago Incentive Explorer")).toBeTruthy();
    expect(screen.getByText("Your report is ready")).toBeTruthy();
    expect(screen.getByText("4200 S California Ave, Chicago, IL")).toBeTruthy();
    expect(screen.getByText("Which best describes you?")).toBeTruthy();
    for (const label of BOARD_PERSONA_LABELS) {
      expect(screen.getByRole("button", { name: label }), label).toBeTruthy();
    }
    expect(
      screen.getByText("What brings you here? (Pick up to 2 — or just looking)"),
    ).toBeTruthy();
    for (const label of BOARD_GOAL_LABELS) {
      expect(goalChip(label), label).toBeTruthy();
    }
    expect(viewButton().textContent).toContain("View my report");
    expect(screen.getByText("Want a hand? (Optional)")).toBeTruthy();
    expect(screen.getByPlaceholderText("Name")).toBeTruthy();
    expect(screen.getByPlaceholderText("you@business.com")).toBeTruthy();
    expect(
      screen.getByText("I’d like 1-on-1 support working through this report"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "A real person from the Southeast Chicago Chamber of Commerce will follow up within 48 hours.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Come back anytime")).toBeTruthy();
    expect(
      screen.getByText("Save this report and pick up right where you left off."),
    ).toBeTruthy();
    expect(saveButton().textContent).toContain("Save my report");
    // Full footer text, including the tail (gate review round 1, finding 10,
    // row 30 — the old test only asserted the prefix).
    expect(
      screen.getByText(
        "PDF & email tools live inside the report — where you can see what they’re about",
      ),
    ).toBeTruthy();
  });

  it("goal chips render in exact board order", () => {
    renderGate();
    const buttons = BOARD_GOAL_LABELS.map((label) => goalChip(label));
    const positions = buttons.map((button) =>
      Array.from(document.querySelectorAll<HTMLElement>("button")).indexOf(button),
    );
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("BLOCKER 4: footer claims only PDF & email — never 'window reminders', which has no backend anywhere in this repo", () => {
    renderGate();
    const text = document.body.textContent || "";
    expect(text).not.toContain("window reminders");
    expect(text).not.toContain("PDF, email &");
  });

  it("removes email-delivery-of-report, PDF download, and 'Continue Without Email' from the gate", () => {
    renderGate();
    expect(screen.queryByText("Email and View Report")).toBeNull();
    expect(screen.queryByText("Continue Without Email")).toBeNull();
    expect(screen.queryByTestId("report-pdf-download")).toBeNull();
    expect(screen.queryByText("Download PDF")).toBeNull();
    expect((document.body.textContent || "").toLowerCase()).not.toContain("newsletter");
  });

  it("'Just looking around' is visually distinct (dashed) from the 7 substantive chips", () => {
    renderGate();
    expect(goalChip("Just looking around").className).toContain("border-dashed");
    expect(goalChip("Renovate or build out").className).toContain("border-solid");
  });
});

describe("ReportEmailGate — enable transition (falsification F5)", () => {
  it("View and Save start disabled, with the exact helper copy", () => {
    renderGate();
    expect(viewButton().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByTestId("report-email-gate-helper").textContent).toBe(
      "Pick what brings you here to continue",
    );
  });

  it("picking a goal chip enables both View and Save, and hides the helper", () => {
    renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    expect(viewButton().disabled).toBe(false);
    expect(saveButton().disabled).toBe(false);
    expect(screen.queryByTestId("report-email-gate-helper")).toBeNull();
  });

  it("'Just looking around' alone also enables both buttons", () => {
    renderGate();
    fireEvent.click(goalChip("Just looking around"));
    expect(viewButton().disabled).toBe(false);
  });
});

describe("ReportEmailGate — 'Just looking around' exclusivity + 2-chip cap (F4/F9, DOM level)", () => {
  it("selecting a 3rd substantive chip is ignored — only 2 stay pressed", () => {
    renderGate();
    fireEvent.click(goalChip("Renovate or build out"));
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(goalChip("Energy & building upgrades"));
    expect(goalChip("Renovate or build out").getAttribute("aria-pressed")).toBe("true");
    expect(goalChip("Hire or train staff").getAttribute("aria-pressed")).toBe("true");
    expect(goalChip("Energy & building upgrades").getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking 'Just looking around' after a substantive pick clears it — exclusive", () => {
    renderGate();
    fireEvent.click(goalChip("Renovate or build out"));
    fireEvent.click(goalChip("Just looking around"));
    expect(goalChip("Renovate or build out").getAttribute("aria-pressed")).toBe("false");
    expect(goalChip("Just looking around").getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking a substantive chip after 'Just looking around' clears looking", () => {
    renderGate();
    fireEvent.click(goalChip("Just looking around"));
    fireEvent.click(goalChip("Build new"));
    expect(goalChip("Just looking around").getAttribute("aria-pressed")).toBe("false");
    expect(goalChip("Build new").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ReportEmailGate — BLOCKER 1: no goal id is ever silently dropped", () => {
  it("2 grouped chips (4 ids) all reach onPrepareReport — the reviewer's exact reproduction", async () => {
    const { onPrepareReport } = renderGate();
    fireEvent.click(goalChip("Expand or buy equipment"));
    fireEvent.click(goalChip("Develop housing or mixed-use"));
    fireEvent.click(viewButton());

    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(new Set(goalIds)).toEqual(
      new Set(["expansion", "equipment", "mixed-use", "affordable-housing"]),
    );
    expect(goalIds.length).toBe(4);
  });
});

describe("ReportEmailGate — BLOCKER 2: never destroys pre-existing goals or custom-goal text", () => {
  it("pre-selects the chip implied by an existing single-id goal and starts enabled", () => {
    renderGate({
      report: { ...baseReport, metadata: { ...baseReport.metadata, projectGoals: ["hiring"] } },
    });
    expect(goalChip("Hire or train staff").getAttribute("aria-pressed")).toBe("true");
    expect(viewButton().disabled).toBe(false);
  });

  it("an id with no chip ('other') plus its custom-goal text survive untouched through View", async () => {
    const { onPrepareReport } = renderGate({
      report: {
        ...baseReport,
        metadata: {
          ...baseReport.metadata,
          projectGoals: ["other"],
          projectType: "other",
          customGoal: "converting a church into a daycare",
        },
      },
    });

    // No chip represents "other" — the gate must still start enabled
    // (the visitor already answered this in the wizard) rather than
    // forcing a re-pick from a chip set that has no equivalent.
    expect(viewButton().disabled).toBe(false);

    fireEvent.click(viewButton());
    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds, customGoal] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(goalIds).toContain("other");
    expect(customGoal).toBe("converting a church into a daycare");
  });

  it("an unmatched existing goal survives alongside a newly picked chip", async () => {
    const { onPrepareReport } = renderGate({
      report: {
        ...baseReport,
        metadata: { ...baseReport.metadata, projectGoals: ["vacant-acquisition"] },
      },
    });
    fireEvent.click(goalChip("Renovate or build out"));
    fireEvent.click(viewButton());
    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(new Set(goalIds)).toEqual(new Set(["vacant-acquisition", "rehab"]));
  });

  it("explicitly picking 'Just looking around' overrides and clears an unmatched pass-through goal", async () => {
    const { onPrepareReport } = renderGate({
      report: {
        ...baseReport,
        metadata: { ...baseReport.metadata, projectGoals: ["vacant-acquisition"] },
      },
    });
    fireEvent.click(goalChip("Just looking around"));
    fireEvent.click(viewButton());
    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(goalIds).toEqual([]);
  });
});

describe("ReportEmailGate — gate review round 2, NEW-1: seeding must never silently ADD an id", () => {
  it("an existing single-id goal ('expansion') pre-presses its grouped chip for display, but View sends ONLY the original id — never the chip's other id ('equipment')", async () => {
    const { onPrepareReport } = renderGate({
      report: { ...baseReport, metadata: { ...baseReport.metadata, projectGoals: ["expansion"] } },
    });
    // Display: the closest chip is honestly pre-pressed.
    expect(goalChip("Expand or buy equipment").getAttribute("aria-pressed")).toBe("true");

    // Emission: untouched, so only the REAL original id goes out.
    fireEvent.click(viewButton());
    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(goalIds).toEqual(["expansion"]);
    expect(goalIds).not.toContain("equipment");
  });

  it("same probe for 'mixed-use' alone — 'affordable-housing' must never be silently added", async () => {
    const { onPrepareReport } = renderGate({
      report: { ...baseReport, metadata: { ...baseReport.metadata, projectGoals: ["mixed-use"] } },
    });
    expect(goalChip("Develop housing or mixed-use").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(viewButton());
    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(goalIds).toEqual(["mixed-use"]);
  });

  it("an ACTUAL toggle switches emission to the chip-derived mapping — deselecting then reselecting the same chip legitimately sends both real ids", async () => {
    const { onPrepareReport } = renderGate({
      report: { ...baseReport, metadata: { ...baseReport.metadata, projectGoals: ["expansion"] } },
    });
    // A real interaction: deselect, then reselect the same chip.
    fireEvent.click(goalChip("Expand or buy equipment"));
    fireEvent.click(goalChip("Expand or buy equipment"));
    fireEvent.click(viewButton());
    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    // Now a real toggle happened, so the chip's full, real mapping applies.
    expect(new Set(goalIds)).toEqual(new Set(["expansion", "equipment"]));
  });
});

describe("ReportEmailGate — gate review round 2, NEW-2: seeded state above the 2-chip cap stays recoverable", () => {
  it("a 3-goal wizard run pre-presses all 3 chips, even though the board says 'Pick up to 2'", () => {
    renderGate({
      report: {
        ...baseReport,
        metadata: { ...baseReport.metadata, projectGoals: ["rehab", "hiring", "energy"] },
      },
    });
    expect(goalChip("Renovate or build out").getAttribute("aria-pressed")).toBe("true");
    expect(goalChip("Hire or train staff").getAttribute("aria-pressed")).toBe("true");
    expect(goalChip("Energy & building upgrades").getAttribute("aria-pressed")).toBe("true");
  });

  it("deselecting a seeded chip and re-clicking it recovers it — never stranded (the reviewer's exact reproduction)", () => {
    renderGate({
      report: {
        ...baseReport,
        metadata: { ...baseReport.metadata, projectGoals: ["rehab", "hiring", "energy"] },
      },
    });
    fireEvent.click(goalChip("Energy & building upgrades"));
    expect(goalChip("Energy & building upgrades").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(goalChip("Energy & building upgrades"));
    expect(goalChip("Energy & building upgrades").getAttribute("aria-pressed")).toBe("true");
  });

  it("a fresh visitor (no seed) is still capped at 2 substantive chips", () => {
    renderGate();
    fireEvent.click(goalChip("Renovate or build out"));
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(goalChip("Energy & building upgrades"));
    expect(goalChip("Energy & building upgrades").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("ReportEmailGate — gate review round 2, NEW-5: an untouched gate never regenerates or flips projectType", () => {
  it("an untouched 2-goal report emits the ORIGINAL array verbatim, in the ORIGINAL order — not chip-definition order", async () => {
    // "hiring" is chip-definition-order AFTER "rehab" (GATE_GOAL_CHIPS has
    // "renovate" before "hire-train") — storing them reversed is exactly
    // the probe that would flip if emission re-derived from chips.
    const { onPrepareReport } = renderGate({
      report: {
        ...baseReport,
        metadata: { ...baseReport.metadata, projectGoals: ["hiring", "rehab"] },
      },
    });
    fireEvent.click(viewButton());
    await waitFor(() => expect(onPrepareReport).toHaveBeenCalledTimes(1));
    const [goalIds] = (onPrepareReport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(goalIds).toEqual(["hiring", "rehab"]);
  });
});

describe("ReportEmailGate — BLOCKER 3(a): invalid support email blocks with a visible inline error", () => {
  it("checking the box with a blank email blocks View — no prepare call, no navigation, visible error", async () => {
    const { onPrepareReport, onReportReady } = renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(viewButton());

    await waitFor(() =>
      expect(
        screen.getByText("Enter an email so we know where to follow up."),
      ).toBeTruthy(),
    );
    expect(onPrepareReport).not.toHaveBeenCalled();
    expect(onReportReady).not.toHaveBeenCalled();
    expect(submitSupportRequestMock).not.toHaveBeenCalled();
  });

  it("typing a valid email clears the inline error", async () => {
    renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(viewButton());
    await waitFor(() =>
      expect(screen.getByText("Enter an email so we know where to follow up.")).toBeTruthy(),
    );

    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    expect(screen.queryByText("Enter an email so we know where to follow up.")).toBeNull();
  });
});

describe("ReportEmailGate — BLOCKER 3(b)/(c): support submission is awaited and failures surface before unmount/navigation", () => {
  it("View: a real submission failure is surfaced (dialog stays mounted, onReportReady NOT called); a second click proceeds", async () => {
    submitSupportRequestMock.mockRejectedValueOnce(new Error("Support inbox is offline"));
    const { onReportReady } = renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });

    fireEvent.click(viewButton());
    await waitFor(() => expect(submitSupportRequestMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Support inbox is offline")).toBeTruthy());
    expect(onReportReady).not.toHaveBeenCalled();
    // Still mounted — a role="alert" the visitor can actually see.
    expect(screen.getByTestId("report-email-gate")).toBeTruthy();

    // Second click: does not retry the failed submission, but DOES proceed.
    fireEvent.click(viewButton());
    await waitFor(() => expect(onReportReady).toHaveBeenCalledTimes(1));
    expect(submitSupportRequestMock).toHaveBeenCalledTimes(1);
  });

  it("Save (unauthenticated): navigation is awaited AFTER a successful submission, never before", async () => {
    let resolveSubmit: (value: { success: true }) => void = () => {};
    submitSupportRequestMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmit = resolve as typeof resolveSubmit;
      }),
    );
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignMock },
      writable: true,
    });

    renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(submitSupportRequestMock).toHaveBeenCalledTimes(1));
    // The request is still pending — navigation must NOT have happened yet.
    expect(assignMock).not.toHaveBeenCalled();

    resolveSubmit({ success: true });
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock.mock.calls[0][0]).toContain("/login?callbackUrl=");
  });

  it("Save (unauthenticated): a submission failure blocks the redirect entirely", async () => {
    submitSupportRequestMock.mockRejectedValueOnce(new Error("Support inbox is offline"));
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignMock },
      writable: true,
    });

    renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText("Support inbox is offline")).toBeTruthy());
    expect(assignMock).not.toHaveBeenCalled();
  });
});

describe("ReportEmailGate — the support path is genuinely exercised end to end (falsification F7)", () => {
  it("a checked box with a valid email actually calls submitSupportRequest with the right payload", async () => {
    const customReport = {
      ...baseReport,
      metadata: { ...baseReport.metadata, address: "123 Main St" },
    };
    renderGate({
      report: customReport,
      onPrepareReport: vi.fn().mockResolvedValue(customReport),
    });
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Jordan" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    fireEvent.click(viewButton());

    await waitFor(() => expect(submitSupportRequestMock).toHaveBeenCalledTimes(1));
    const call = submitSupportRequestMock.mock.calls[0][0];
    expect(call.email).toBe("owner@business.com");
    expect(call.name).toBe("Jordan");
    expect(call.address).toBe("123 Main St");
    expect(call.source).toBe("report_email_gate");
  });

  it("an unchecked box never calls submitSupportRequest", async () => {
    const { onReportReady } = renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(viewButton());
    await waitFor(() => expect(onReportReady).toHaveBeenCalledTimes(1));
    expect(submitSupportRequestMock).not.toHaveBeenCalled();
  });
});

describe("ReportEmailGate — persona pre-selection (gate review round 2, NEW-4/row 6-9 fix — these tests genuinely exist now)", () => {
  it("pre-selects Business owner via aria-pressed when no strong signal is present", () => {
    renderGate();
    expect(
      screen.getByRole("button", { name: "Business owner" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Just looking" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Supporting businesses" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Developer" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("pre-selects the inferred lens from industry/goal (developer signal) via aria-pressed", () => {
    renderGate({
      report: { ...baseReport, metadata: { ...baseReport.metadata, industry: "realEstate" } },
    });
    expect(
      screen.getByRole("button", { name: "Developer" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Business owner" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("renders 'Just looking' as a real, enabled, tappable chip — not merely inferable", () => {
    renderGate();
    const chip = screen.getByRole("button", { name: "Just looking" }) as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ReportEmailGate — persona analytics honesty (finding 11)", () => {
  it("reports outcome 'inferred' when the persona chip is never tapped", async () => {
    const { onReportReady } = renderGate();
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(viewButton());
    await waitFor(() => expect(onReportReady).toHaveBeenCalledTimes(1));

    const call = trackEventMock.mock.calls.find(([type]) => type === "persona_intake_inferred");
    expect(call?.[1]?.metadata?.outcome).toBe("inferred");
  });

  it("reports outcome 'confirmed' when the visitor taps the already-inferred chip", async () => {
    const { onReportReady } = renderGate();
    // Default inference for a signal-free report is the "Business owner" group.
    fireEvent.click(screen.getByRole("button", { name: "Business owner" }));
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(viewButton());
    await waitFor(() => expect(onReportReady).toHaveBeenCalledTimes(1));

    const call = trackEventMock.mock.calls.find(([type]) => type === "persona_intake_inferred");
    expect(call?.[1]?.metadata?.outcome).toBe("confirmed");
  });

  it("reports outcome 'corrected' when the visitor taps a DIFFERENT chip than the inferred one", async () => {
    const { onReportReady } = renderGate();
    fireEvent.click(screen.getByRole("button", { name: "Developer" }));
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(viewButton());
    await waitFor(() => expect(onReportReady).toHaveBeenCalledTimes(1));

    const call = trackEventMock.mock.calls.find(([type]) => type === "persona_intake_inferred");
    expect(call?.[1]?.metadata?.outcome).toBe("corrected");
    expect(call?.[1]?.metadata?.selectedPersona).toBe("developer");
  });
});

describe("ReportEmailGate — prepare failure surfaces a real, visible error (parity row 51)", () => {
  it("shows the alert box when onPrepareReport rejects", async () => {
    const onPrepareReport = vi.fn().mockRejectedValue(new Error("boom"));
    renderGate({ onPrepareReport });
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(viewButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("shows a fallback message when onPrepareReport resolves null", async () => {
    const onPrepareReport = vi.fn().mockResolvedValue(null);
    renderGate({ onPrepareReport });
    fireEvent.click(goalChip("Hire or train staff"));
    fireEvent.click(viewButton());

    await waitFor(() =>
      expect(
        screen.getByText("We could not prepare the report. Please try again."),
      ).toBeTruthy(),
    );
  });
});
