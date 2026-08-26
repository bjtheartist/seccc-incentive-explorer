import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermitExhibitLoadResult } from "@/lib/permit-exhibit-source";
import { FIXTURE_PERMIT_EXHIBIT_MIXED } from "@/lib/permit-exhibit-fixtures";
import { createShortlistAccessSession } from "@/lib/shortlist-access";

const { loadPermitExhibitMock, accessCookieMock } = vi.hoisted(() => ({
  loadPermitExhibitMock: vi.fn<() => Promise<PermitExhibitLoadResult>>(),
  accessCookieMock: vi.fn<() => { value: string } | undefined>(() => undefined),
}));

vi.mock("@/lib/permit-exhibit-source", () => ({ loadPermitExhibit: loadPermitExhibitMock }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: accessCookieMock }) }));

vi.mock("@/components/permit-exhibit/SubjectParcelSection", () => ({
  SubjectParcelSection: () => <div>SENSITIVE S1 SUBJECT ROWS</div>,
}));
vi.mock("@/components/permit-exhibit/AreaContextSection", () => ({
  AreaContextSection: () => <div>SENSITIVE S2 AREA ROWS</div>,
}));
vi.mock("@/components/permit-exhibit/BoundaryContextSection", () => ({
  BoundaryContextSection: () => <div>SENSITIVE S3 BOUNDARY</div>,
}));
vi.mock("@/components/permit-exhibit/MethodsFooter", () => ({
  MethodsFooter: () => <div>SENSITIVE S4 METHODS</div>,
}));

import PermitExhibitPrintPage from "../page";

async function render(pin: string, searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await PermitExhibitPrintPage({
      params: Promise.resolve({ pin }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "permit-exhibit-print-test-secret";
  loadPermitExhibitMock.mockReset();
  accessCookieMock.mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Print route pinning tests, mirroring the on-screen page's gate:
 * server-side, content absent from the HTML entirely when unauthenticated
 * — the print route must never be a back door around the signup gate.
 */
describe("Permit Exhibit print route — gate (server-side, fail-closed)", () => {
  it("withholds every exhibit section without a valid session — the loader is never even called", async () => {
    const html = await render("17091190280000");
    expect(html).not.toContain("SENSITIVE S1 SUBJECT ROWS");
    expect(html).not.toContain("SENSITIVE S2 AREA ROWS");
    expect(html).not.toContain("SENSITIVE S3 BOUNDARY");
    expect(html).not.toContain("SENSITIVE S4 METHODS");
    expect(loadPermitExhibitMock).not.toHaveBeenCalled();
    expect(html).toMatch(/Sign up for exhibit access/);
  });

  it("renders every section once a signed access session is present", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadPermitExhibitMock.mockResolvedValue({ ok: true, data: FIXTURE_PERMIT_EXHIBIT_MIXED });
    const html = await render("17091190280000");
    expect(html).toContain("SENSITIVE S1 SUBJECT ROWS");
    expect(html).toContain("SENSITIVE S2 AREA ROWS");
    expect(html).toContain("SENSITIVE S3 BOUNDARY");
    expect(html).toContain("SENSITIVE S4 METHODS");
  });

  it("renders honest unavailable copy (not a crash) for an invalid PIN, even when authenticated", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadPermitExhibitMock.mockResolvedValue({ ok: false, error: { kind: "invalid_pin" } });
    const html = await render("not-a-pin");
    expect(html).toMatch(/14-digit Cook County PIN/);
  });
});
