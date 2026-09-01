// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FundingWindowChart } from "@/components/report/FundingWindowChart";
import { SECTION_IDS, type GeneratedReport } from "@/lib/report-engine";

vi.mock("@/lib/pdf-report", () => ({
  generateReportPdfBase64: () => ({ base64: "ZmFrZS1wZGY=", filename: "report.pdf" }),
}));

const reportWithWindow: GeneratedReport = {
  title: "Site Incentive Analysis",
  subtitle: "",
  reportType: "site-incentives",
  generatedAt: "2026-08-20T12:00:00.000Z",
  summary: "",
  sections: [
    {
      id: SECTION_IDS.upcomingDeadlines,
      title: "Upcoming Deadlines Near This Address",
      items: [
        {
          programId: "sbif",
          label: "SBIF application window",
          deadlineKind: "sbif_window",
          deadlineDate: "2026-09-15",
          deadlineWindowEnd: "2026-10-15",
        } as unknown as GeneratedReport["sections"][number]["items"][number],
      ],
    },
  ],
  recommendedActions: [],
  metadata: { address: "4200 S California Ave, Chicago, IL" },
};

const reportWithoutWindow: GeneratedReport = {
  ...reportWithWindow,
  sections: [],
};

/** Normalizes curly vs. straight apostrophes so a banned-phrase check
 *  can't be defeated by which quote character the copy happens to use
 *  (gate review round 1, MAJOR finding 9/F10: React escapes `'` to
 *  `&#x27;`/`&rsquo;` in raw HTML, so a raw-string `.toContain("we'll")`
 *  check never fires against `renderToStaticMarkup` output — using
 *  `@testing-library/react` + real DOM `.textContent` here sidesteps
 *  that entirely, since the DOM always exposes decoded text). */
function normalizeApostrophes(text: string): string {
  return text.replace(/[‘’']/g, "'");
}

// ─── Funding window inline email offer (email-gate redesign, spec §C) ───
// This is also this surface's "dedicated rendered-output test" for its
// reviewed-copy claim-surface registration (lib/public-claim-surfaces.ts):
// the honest, non-fabricated copy is asserted here directly against the
// real, rendered (not raw-HTML) text.

describe("FundingWindowChart inline email offer", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing when there is no funding window (chart itself returns null)", () => {
    const { container } = render(<FundingWindowChart report={reportWithoutWindow} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the inline, dismissible, non-modal offer beside a real funding window", () => {
    render(<FundingWindowChart report={reportWithWindow} />);
    expect(screen.getByTestId("funding-window-email-offer")).toBeTruthy();
    const dismiss = screen.getByLabelText("Dismiss");
    expect(dismiss).toBeTruthy();
    // Never a modal: no fixed-inset overlay classes anywhere in the offer.
    expect(screen.getByTestId("funding-window-email-offer").className).not.toContain(
      "fixed inset-0",
    );
  });

  it("dismiss actually removes the offer from the DOM", () => {
    render(<FundingWindowChart report={reportWithWindow} />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByTestId("funding-window-email-offer")).toBeNull();
  });

  it("never promises a future-triggered reminder — only an immediate, real send (decoded DOM text, apostrophe-proof)", () => {
    const { container } = render(<FundingWindowChart report={reportWithWindow} />);
    const text = normalizeApostrophes(container.textContent || "").toLowerCase();
    expect(text).not.toContain("when this window opens");
    expect(text).not.toContain("notify me when");
    expect(text).not.toContain("we'll remind you");
    expect(text).not.toContain("we will remind you");
    expect(text).toContain("right now");
    expect(text).toContain("email me this report");
  });

  it("submit control is disabled without a valid-looking email, enabled once one is typed", () => {
    render(<FundingWindowChart report={reportWithWindow} />);
    const button = screen.getByRole("button", { name: /email me this report/i });
    expect(button.hasAttribute("disabled")).toBe(true);

    const input = screen.getByPlaceholderText("you@business.com");
    fireEvent.change(input, { target: { value: "owner@business.com" } });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("sends the report immediately via the existing /api/email-report mechanism on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<FundingWindowChart report={reportWithWindow} />);
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me this report/i }));

    await screen.findByText(/sent — check your inbox/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/email-report");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.email).toBe("owner@business.com");
    expect(body.source).toBe("funding_window_inline_offer");
  });

  /**
   * R1 finding 5 — the email half. This send had NO deadline of any kind, so
   * a stalled connection left the offer on "Sending…" indefinitely with
   * nothing said and nothing to click. It now carries the same 30s ceiling as
   * the Email Report modal, and reports a timeout in its own words.
   */
  it("carries an abort deadline on the send — a stalled request cannot hang the offer forever", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<FundingWindowChart report={reportWithWindow} />);
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me this report/i }));
    await screen.findByText(/sent — check your inbox/i);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an aborted send as 'took too long', distinctly from a rejected one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
    );

    render(<FundingWindowChart report={reportWithWindow} />);
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me this report/i }));

    const message = await screen.findByText(/took too long/i);
    expect(normalizeApostrophes(message.textContent ?? "")).toContain("was not sent");
  });

  it("still reports an ordinary server rejection in the server's own words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Email service is not configured" }) }),
    );

    render(<FundingWindowChart report={reportWithWindow} />);
    fireEvent.change(screen.getByPlaceholderText("you@business.com"), {
      target: { value: "owner@business.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /email me this report/i }));

    await screen.findByText(/Email service is not configured/i);
    expect(screen.queryByText(/took too long/i)).toBeNull();
  });
});
