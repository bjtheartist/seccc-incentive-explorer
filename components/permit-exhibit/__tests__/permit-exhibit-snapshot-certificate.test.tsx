// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID,
  PERMIT_EXHIBIT_SNAPSHOT_HASH,
  PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID,
  fixturePermitExhibitSnapshot,
} from "@/tests/fixtures/permit-exhibit-snapshot";
import {
  PermitExhibitSnapshotCertificate,
  PermitExhibitSnapshotProvenance,
  formatPermitExhibitSnapshotSavedDate,
} from "../PermitExhibitSnapshotCertificate";

afterEach(() => {
  cleanup();
});

describe("Permit exhibit saved-snapshot certificate — approved option 1", () => {
  it("pins the approved read-only certificate copy and saved timestamp", () => {
    render(<PermitExhibitSnapshotCertificate snapshot={fixturePermitExhibitSnapshot()} />);

    expect(screen.getByRole("heading", { name: "Saved snapshot · Read only" })).toBeTruthy();
    expect(screen.getByText("Saved Aug 26, 2026 · 10:18 AM CDT")).toBeTruthy();
    expect(screen.getByText(`Snapshot ${PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID}`)).toBeTruthy();
    expect(
      screen.getByText("This saved exhibit does not change when source records change."),
    ).toBeTruthy();
  });

  it("links print to the frozen artifact and current exhibit to the stored PIN and radius", () => {
    render(<PermitExhibitSnapshotCertificate snapshot={fixturePermitExhibitSnapshot()} />);

    const printLink = screen.getByRole("link", { name: "Print / Save PDF" });
    expect(printLink.getAttribute("href")).toBe(
      `/print/permit-exhibit/snapshots/${PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID}`,
    );

    const currentLink = screen.getByRole("link", { name: "Open current exhibit" });
    expect(currentLink.getAttribute("href")).toBe(
      "/permit-exhibit/20363230080000?radius=500",
    );
    expect(currentLink.getAttribute("target")).toBe("_blank");
    expect(currentLink.getAttribute("rel")).toBe("noreferrer");
  });

  it("launches the browser print dialog from the dedicated print surface", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(
      <PermitExhibitSnapshotCertificate
        snapshot={fixturePermitExhibitSnapshot()}
        printMode
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Print / Save PDF" }));
    expect(print).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "Print / Save PDF" })).toBeNull();
    print.mockRestore();
  });

  it("uses Chicago time for the saved date at the UTC midnight boundary", () => {
    expect(formatPermitExhibitSnapshotSavedDate("2026-08-26T03:30:00.000Z")).toBe(
      "Aug 25, 2026",
    );
  });
});

describe("Permit exhibit saved-snapshot provenance — approved option 1", () => {
  it("pins the preview, integrity line, exact labels, dynamic counts, and immutability note", () => {
    const snapshot = fixturePermitExhibitSnapshot();
    render(<PermitExhibitSnapshotProvenance snapshot={snapshot} />);

    const provenance = screen.getByTestId("snapshot-provenance");
    expect(within(provenance).getByText("Snapshot provenance", { exact: false }).textContent).toBe(
      "Snapshot provenance (preview)",
    );
    expect(within(provenance).getByText("View full provenance")).toBeTruthy();
    expect(within(provenance).getByText(`SHA-256: ${PERMIT_EXHIBIT_SNAPSHOT_HASH}`)).toBeTruthy();
    expect(
      within(provenance).getByText(
        "Source vintages: City permits Aug 24, 2026 · Parcel context Aug 24, 2026 · Zoning record Jan 15, 2025 · Zoning archive Not recorded",
      ),
    ).toBeTruthy();

    const expectedDetails = [
      ["Snapshot ID", PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID],
      ["Subject PIN", snapshot.exhibit.meta.subjectParcel.pinFormatted],
      ["Application revision", "42d5b66"],
      ["Query", "PIN 20363230080000 · radius 500 ft"],
      ["Permit rows preserved", "10"],
      ["Unlocated records disclosed", "1"],
    ] as const;
    for (const [label, value] of expectedDetails) {
      const term = within(provenance).getByText(label);
      expect(term.className).toContain("text-[#697485]");
      expect(term.parentElement?.querySelector("dd")?.textContent).toBe(value);
    }

    expect(
      within(provenance).getByText(
        "This copy reopens the evidence exactly as it was generated. It does not silently refresh when City or County source records change.",
      ),
    ).toBeTruthy();
  });

  it("renders full, untoggled provenance for print", () => {
    render(
      <PermitExhibitSnapshotProvenance
        snapshot={fixturePermitExhibitSnapshot()}
        forceExpanded
      />,
    );

    expect(screen.getByRole("heading", { name: "Snapshot provenance" })).toBeTruthy();
    expect(screen.queryByText("Snapshot provenance (preview)")).toBeNull();
    expect(screen.queryByText("View full provenance")).toBeNull();
    expect(screen.getByTestId("snapshot-provenance-details")).toBeTruthy();
  });
});
