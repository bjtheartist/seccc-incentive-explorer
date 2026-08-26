import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermitExhibitSnapshot } from "@/lib/permit-exhibit-snapshot";
import {
  PermitExhibitSnapshotCorruptError,
  PermitExhibitSnapshotStorageUnavailableError,
} from "@/lib/permit-exhibit-snapshot";
import { createShortlistAccessSession } from "@/lib/shortlist-access";
import {
  PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID,
  PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID,
  fixturePermitExhibitSnapshot,
} from "@/tests/fixtures/permit-exhibit-snapshot";

const { loadSnapshotMock, loadLiveExhibitMock, accessCookieMock } = vi.hoisted(() => ({
  loadSnapshotMock: vi.fn<(publicId: string) => Promise<PermitExhibitSnapshot | null>>(),
  loadLiveExhibitMock: vi.fn(),
  accessCookieMock: vi.fn<() => { value: string } | undefined>(() => undefined),
}));

vi.mock("@/lib/permit-exhibit-snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permit-exhibit-snapshot")>(
    "@/lib/permit-exhibit-snapshot",
  );
  return { ...actual, loadPermitExhibitSnapshot: loadSnapshotMock };
});
vi.mock("@/lib/permit-exhibit-source", () => ({ loadPermitExhibit: loadLiveExhibitMock }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: accessCookieMock }) }));

vi.mock("@/components/permit-exhibit/SubjectParcelSection", () => ({
  SubjectParcelSection: ({ subject }: { subject: unknown[] }) => (
    <div>PRINT S1 STORED SUBJECT · {subject.length}</div>
  ),
}));
vi.mock("@/components/permit-exhibit/AreaContextSection", () => ({
  AreaContextSection: ({ area }: { area: { rows: unknown[] } }) => (
    <div>PRINT S2 STORED AREA · {area.rows.length}</div>
  ),
}));
vi.mock("@/components/permit-exhibit/BoundaryContextSection", () => ({
  BoundaryContextSection: () => <div>PRINT S3 STORED BOUNDARY</div>,
}));
vi.mock("@/components/permit-exhibit/MethodsFooter", () => ({
  MethodsFooter: () => <div>PRINT S4 STORED METHODS</div>,
}));
vi.mock("@/components/permit-exhibit/PermitExhibitSnapshotCertificate", () => ({
  PermitExhibitSnapshotCertificate: ({
    snapshot,
    printMode,
  }: {
    snapshot: PermitExhibitSnapshot;
    printMode?: boolean;
  }) => (
    <div>PRINT SAVED CERTIFICATE · {snapshot.displayId} · print mode {String(printMode)}</div>
  ),
  formatPermitExhibitSnapshotSavedDate: () => "Aug 26, 2026",
  PermitExhibitSnapshotProvenance: ({
    snapshot,
    forceExpanded,
  }: {
    snapshot: PermitExhibitSnapshot;
    forceExpanded?: boolean;
  }) => (
    <div>
      PRINT SAVED PROVENANCE · {snapshot.contentHash} · expanded {String(forceExpanded)}
    </div>
  ),
}));

import SavedPermitExhibitPrintPage from "../page";

async function render(snapshotId = PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID) {
  return renderToStaticMarkup(
    await SavedPermitExhibitPrintPage({ params: Promise.resolve({ snapshotId }) }),
  );
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "saved-permit-exhibit-print-test-secret";
  loadSnapshotMock.mockReset();
  loadLiveExhibitMock.mockReset();
  accessCookieMock.mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Saved Permit Exhibit print page — gate first and stored only", () => {
  it("never loads or emits the saved evidence before the access gate", async () => {
    const html = await render();

    expect(html).toMatch(/Sign up for exhibit access/);
    expect(html).toContain(`/permit-exhibit/snapshots/${PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID}`);
    expect(loadSnapshotMock).not.toHaveBeenCalled();
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
    expect(html).not.toContain("PRINT S1 STORED SUBJECT");
    expect(html).not.toContain("PRINT SAVED PROVENANCE");
  });

  it("prints only the stored S1–S4 evidence with full provenance after access", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockResolvedValue(fixturePermitExhibitSnapshot());

    const html = await render();

    expect(loadSnapshotMock).toHaveBeenCalledOnce();
    expect(loadSnapshotMock).toHaveBeenCalledWith(PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID);
    expect(html).toContain(`PRINT SAVED CERTIFICATE · ${PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID}`);
    expect(html).toContain("print mode true");
    expect(html).toContain("PRINT S1 STORED SUBJECT · 4");
    expect(html).toContain("PRINT S2 STORED AREA · 6");
    expect(html).toContain("PRINT S3 STORED BOUNDARY");
    expect(html).toContain("PRINT S4 STORED METHODS");
    expect(html).toContain("PRINT SAVED PROVENANCE · c257218754f74d16");
    expect(html).toContain("expanded true");
    expect(html).toContain("text-[#697485]");
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
    expect(html).toContain("body > header");
    expect(html).toContain("overflow: visible");
  });

  it("distinguishes an unknown saved ID from a storage outage and never falls back live", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockResolvedValue(null);

    const html = await render();

    expect(html).toContain("That saved exhibit was not found. No current exhibit was substituted.");
    expect(html).not.toContain("temporarily unavailable");
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
  });

  it("reports a corrupt snapshot without printing or rebuilding live evidence", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockRejectedValue(new PermitExhibitSnapshotCorruptError());

    const html = await render();

    expect(html).toContain(
      "This saved exhibit did not pass its integrity or version check. It was not rebuilt from current records.",
    );
    expect(html).not.toContain("PRINT S1 STORED SUBJECT");
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
  });

  it("reports snapshot storage unavailability without printing or rebuilding live evidence", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockRejectedValue(new PermitExhibitSnapshotStorageUnavailableError());

    const html = await render();

    expect(html).toContain("Snapshot storage is temporarily unavailable. No current exhibit was substituted.");
    expect(html).not.toContain("PRINT S1 STORED SUBJECT");
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
  });
});
