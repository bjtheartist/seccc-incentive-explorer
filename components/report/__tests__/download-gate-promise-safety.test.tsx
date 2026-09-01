// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }));
vi.mock("@/lib/analytics-events", () => ({ trackEvent: trackEventMock }));

import { DownloadGateModal, PDF_DOWNLOAD_FAILURE_MESSAGE } from "../ReportModals";

/**
 * R1 finding 5 — PDF promise safety.
 *
 * `onDownload` was typed `() => void`, so the async PDF work every caller
 * actually does was fire-and-forget. Two concrete defects followed:
 *
 *   1. A rejected download became an unhandled rejection while the modal had
 *      already moved to status "done" — it declared success for a file that
 *      was never produced, and the reader was left with a wedged gate.
 *   2. On the "download without sharing details" path, `report_pdf_downloaded`
 *      fired BEFORE `onDownload()` was even called, so every failed download
 *      on that path was counted as a successful one.
 */

const BASE = {
  reportAddress: "1207 W 63rd St",
  reportTitle: "Fixture Report",
  onClose: () => {},
};

function fillGate() {
  fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("60617"), { target: { value: "60636" } });
}

beforeEach(() => {
  trackEventMock.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DownloadGateModal: a failed download is stated, not declared done", () => {
  it("awaits onDownload and shows a retry state when it rejects", async () => {
    const onDownload = vi.fn().mockRejectedValue(new Error("jsPDF exploded"));
    render(<DownloadGateModal {...BASE} onDownload={onDownload} />);
    fillGate();
    fireEvent.click(screen.getByTestId("download-gate-submit"));

    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    await screen.findByTestId("download-gate-error");
    expect(screen.getByTestId("download-gate-error").textContent).toContain(
      PDF_DOWNLOAD_FAILURE_MESSAGE,
    );
    // The button offers the retry rather than sitting at a finished state.
    expect(screen.getByTestId("download-gate-submit").textContent).toContain("Try Again");
  });

  it("the retry actually re-runs the same download, and a second success clears the error", async () => {
    const onDownload = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    render(<DownloadGateModal {...BASE} onDownload={onDownload} />);
    fillGate();
    fireEvent.click(screen.getByTestId("download-gate-submit"));
    await screen.findByTestId("download-gate-error");

    fireEvent.click(screen.getByTestId("download-gate-submit"));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("download-gate-error")).toBeNull());
  });

  it("a successful download leaves no error state", async () => {
    const onDownload = vi.fn().mockResolvedValue(undefined);
    render(<DownloadGateModal {...BASE} onDownload={onDownload} />);
    fillGate();
    fireEvent.click(screen.getByTestId("download-gate-submit"));

    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("download-gate-error")).toBeNull();
  });
});

describe("DownloadGateModal skip path: report_pdf_downloaded fires ONLY on success", () => {
  it("does NOT fire the download event when the download rejects", async () => {
    const onDownload = vi.fn().mockRejectedValue(new Error("nope"));
    render(<DownloadGateModal {...BASE} onDownload={onDownload} allowSkip />);

    fireEvent.click(screen.getByTestId("download-gate-skip"));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    await screen.findByTestId("download-gate-error");

    const downloadEvents = trackEventMock.mock.calls.filter(
      ([name]) => name === "report_pdf_downloaded",
    );
    expect(downloadEvents).toHaveLength(0);
  });

  it("fires the download event exactly once when the download succeeds", async () => {
    const onDownload = vi.fn().mockResolvedValue(undefined);
    render(<DownloadGateModal {...BASE} onDownload={onDownload} allowSkip />);

    fireEvent.click(screen.getByTestId("download-gate-skip"));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));

    const downloadEvents = trackEventMock.mock.calls.filter(
      ([name]) => name === "report_pdf_downloaded",
    );
    expect(downloadEvents).toHaveLength(1);
    expect(downloadEvents[0][1]).toMatchObject({ source: "report_pdf_gate_skipped" });
  });

  it("the skip retry re-runs the download and then fires the event once", async () => {
    const onDownload = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(undefined);
    render(<DownloadGateModal {...BASE} onDownload={onDownload} allowSkip />);

    fireEvent.click(screen.getByTestId("download-gate-skip"));
    await screen.findByTestId("download-gate-error");
    expect(
      trackEventMock.mock.calls.filter(([name]) => name === "report_pdf_downloaded"),
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("download-gate-skip"));
    await waitFor(() => expect(onDownload).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        trackEventMock.mock.calls.filter(([name]) => name === "report_pdf_downloaded"),
      ).toHaveLength(1),
    );
  });
});
