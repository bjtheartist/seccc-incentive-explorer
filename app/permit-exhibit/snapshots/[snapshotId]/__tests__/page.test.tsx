import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermitExhibitSnapshot } from "@/lib/permit-exhibit-snapshot";
import { createShortlistAccessSession } from "@/lib/shortlist-access";
import {
  PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID,
  PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID,
  fixturePermitExhibitSnapshot,
} from "@/tests/fixtures/permit-exhibit-snapshot";

const { loadSnapshotMock, loadLiveExhibitMock, accessCookieMock, notFoundMock } = vi.hoisted(() => ({
  loadSnapshotMock: vi.fn<(publicId: string) => Promise<PermitExhibitSnapshot | null>>(),
  loadLiveExhibitMock: vi.fn(),
  accessCookieMock: vi.fn<() => { value: string } | undefined>(() => undefined),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/permit-exhibit-snapshot", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permit-exhibit-snapshot")>(
    "@/lib/permit-exhibit-snapshot",
  );
  return { ...actual, loadPermitExhibitSnapshot: loadSnapshotMock };
});
vi.mock("@/lib/permit-exhibit-source", () => ({ loadPermitExhibit: loadLiveExhibitMock }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: accessCookieMock }) }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));

vi.mock("@/components/permit-exhibit/SubjectParcelSection", () => ({
  SubjectParcelSection: ({ subject }: { subject: unknown[] }) => (
    <div>S1 STORED SUBJECT · {subject.length}</div>
  ),
}));
vi.mock("@/components/permit-exhibit/AreaContextSection", () => ({
  AreaContextSection: ({ area }: { area: { rows: unknown[] } }) => (
    <div>S2 STORED AREA · {area.rows.length}</div>
  ),
}));
vi.mock("@/components/permit-exhibit/BoundaryContextSection", () => ({
  BoundaryContextSection: () => <div>S3 STORED BOUNDARY</div>,
}));
vi.mock("@/components/permit-exhibit/MethodsFooter", () => ({
  MethodsFooter: () => <div>S4 STORED METHODS</div>,
}));
vi.mock("@/components/permit-exhibit/PermitExhibitAccessGate", () => ({
  default: () => <div>SAVED EXHIBIT ACCESS GATE</div>,
}));
vi.mock("@/components/permit-exhibit/PermitExhibitSnapshotCertificate", () => ({
  PermitExhibitSnapshotCertificate: ({ snapshot }: { snapshot: PermitExhibitSnapshot }) => (
    <div>SAVED CERTIFICATE · {snapshot.displayId}</div>
  ),
  PermitExhibitSnapshotProvenance: ({ snapshot }: { snapshot: PermitExhibitSnapshot }) => (
    <div>SAVED PROVENANCE · {snapshot.contentHash}</div>
  ),
}));

import SavedPermitExhibitPage from "../page";
import {
  PermitExhibitSnapshotCorruptError,
  PermitExhibitSnapshotStorageUnavailableError,
} from "@/lib/permit-exhibit-snapshot";

async function render(snapshotId = PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID) {
  return renderToStaticMarkup(
    await SavedPermitExhibitPage({ params: Promise.resolve({ snapshotId }) }),
  );
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "saved-permit-exhibit-page-test-secret";
  loadSnapshotMock.mockReset();
  loadLiveExhibitMock.mockReset();
  accessCookieMock.mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Saved Permit Exhibit page — gate first and stored only", () => {
  it("never loads or emits the saved evidence before the access gate", async () => {
    const html = await render();

    expect(html).toContain("SAVED EXHIBIT ACCESS GATE");
    expect(loadSnapshotMock).not.toHaveBeenCalled();
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
    expect(html).not.toContain("S1 STORED SUBJECT");
    expect(html).not.toContain("S2 STORED AREA");
    expect(html).not.toContain("S3 STORED BOUNDARY");
    expect(html).not.toContain("S4 STORED METHODS");
  });

  it("renders the stored certificate, provenance, and every S1–S4 section after access", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockResolvedValue(fixturePermitExhibitSnapshot());

    const html = await render();

    expect(loadSnapshotMock).toHaveBeenCalledOnce();
    expect(loadSnapshotMock).toHaveBeenCalledWith(PERMIT_EXHIBIT_SNAPSHOT_PUBLIC_ID);
    expect(html).toContain(`SAVED CERTIFICATE · ${PERMIT_EXHIBIT_SNAPSHOT_DISPLAY_ID}`);
    expect(html).toContain("SAVED PROVENANCE · c257218754f74d16");
    expect(html).toContain("S1 STORED SUBJECT · 4");
    expect(html).toContain("S2 STORED AREA · 6");
    expect(html).toContain("S3 STORED BOUNDARY");
    expect(html).toContain("S4 STORED METHODS");
    expect(html).not.toContain("SAVED EXHIBIT ACCESS GATE");
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
  });
});

describe("Saved Permit Exhibit page — frozen-artifact failure states", () => {
  it("routes an unknown saved ID to not-found without rebuilding from live records", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledOnce();
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
  });

  it("reports a corrupt or incompatible snapshot without rebuilding from live records", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockRejectedValue(new PermitExhibitSnapshotCorruptError());

    const html = await render();

    expect(html).toContain(
      "This saved exhibit did not pass its integrity or version check. It was not rebuilt from current records.",
    );
    expect(html).not.toContain("S1 STORED SUBJECT");
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
  });

  it("reports storage unavailability without substituting a current exhibit", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadSnapshotMock.mockRejectedValue(new PermitExhibitSnapshotStorageUnavailableError());

    const html = await render();

    expect(html).toContain(
      "Snapshot storage is temporarily unavailable. The saved exhibit was not replaced with current records.",
    );
    expect(html).not.toContain("S1 STORED SUBJECT");
    expect(loadLiveExhibitMock).not.toHaveBeenCalled();
  });
});
