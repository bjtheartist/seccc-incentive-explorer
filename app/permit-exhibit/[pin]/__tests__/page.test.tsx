// Server-component page test, mirroring app/vacancy/[zip]/shortlist's
// fail-closed.test.tsx pattern: the page is an async Server Component
// called directly with its data loader + cookies stubbed, so
// renderToStaticMarkup can inspect the result without a running server.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PermitExhibitLoadResult } from "@/lib/permit-exhibit-source";
import {
  FIXTURE_PERMIT_EXHIBIT_MIXED,
  fixturePermitExhibit,
} from "@/lib/permit-exhibit-fixtures";
import { createShortlistAccessSession } from "@/lib/shortlist-access";

const { loadPermitExhibitMock, accessCookieMock } = vi.hoisted(() => ({
  loadPermitExhibitMock: vi.fn<() => Promise<PermitExhibitLoadResult>>(),
  accessCookieMock: vi.fn<() => { value: string } | undefined>(() => undefined),
}));

vi.mock("@/lib/permit-exhibit-source", () => ({ loadPermitExhibit: loadPermitExhibitMock }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: accessCookieMock }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
vi.mock("@/components/permit-exhibit/PermitExhibitAccessGate", () => ({
  default: () => <div>PERMIT EXHIBIT SIGNUP GATE</div>,
}));

import PermitExhibitPage from "../page";

async function render(pin: string, searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await PermitExhibitPage({
      params: Promise.resolve({ pin }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "permit-exhibit-page-test-secret";
  loadPermitExhibitMock.mockReset();
  accessCookieMock.mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Permit Exhibit page — signup gate (server-side, fail-closed)", () => {
  it("renders the signup gate and NEVER emits the exhibit sections without a valid session", async () => {
    loadPermitExhibitMock.mockResolvedValue({ ok: true, data: FIXTURE_PERMIT_EXHIBIT_MIXED });
    const html = await render("17091190280000");
    expect(html).toContain("PERMIT EXHIBIT SIGNUP GATE");
    expect(html).not.toContain("SENSITIVE S1 SUBJECT ROWS");
    expect(html).not.toContain("SENSITIVE S2 AREA ROWS");
    expect(html).not.toContain("SENSITIVE S3 BOUNDARY");
    expect(html).not.toContain("SENSITIVE S4 METHODS");
    expect(html).not.toContain("Save read-only snapshot");
  });

  it("emits every section once a signed access session is present, and hides the gate", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadPermitExhibitMock.mockResolvedValue({ ok: true, data: FIXTURE_PERMIT_EXHIBIT_MIXED });
    const html = await render("17091190280000");
    expect(html).toContain("SENSITIVE S1 SUBJECT ROWS");
    expect(html).toContain("SENSITIVE S2 AREA ROWS");
    expect(html).toContain("SENSITIVE S3 BOUNDARY");
    expect(html).toContain("SENSITIVE S4 METHODS");
    expect(html).toContain("Save read-only snapshot");
    expect(html).not.toContain("PERMIT EXHIBIT SIGNUP GATE");
  });

  it("still renders the header (address, PIN, exhibit id) even when gated", async () => {
    loadPermitExhibitMock.mockResolvedValue({ ok: true, data: FIXTURE_PERMIT_EXHIBIT_MIXED });
    const html = await render("17091190280000");
    expect(html).toContain(FIXTURE_PERMIT_EXHIBIT_MIXED.meta.subjectParcel.situsAddress!);
    expect(html).toContain(FIXTURE_PERMIT_EXHIBIT_MIXED.meta.exhibitId);
  });
});

describe("Permit Exhibit page — honest unavailable states, never a crash", () => {
  it("renders honest copy for an invalid PIN and never calls anything downstream twice", async () => {
    loadPermitExhibitMock.mockResolvedValue({ ok: false, error: { kind: "invalid_pin" } });
    const html = await render("not-a-pin");
    expect(html).toMatch(/14-digit Cook County PIN/);
    expect(html).not.toContain("SENSITIVE S1 SUBJECT ROWS");
  });

  it("renders honest copy when the parcel is not found", async () => {
    loadPermitExhibitMock.mockResolvedValue({ ok: false, error: { kind: "parcel_not_found" } });
    const html = await render("00000000000000");
    expect(html).toMatch(/No parcel record was found/);
  });

  it("renders the generic unavailable copy for a database outage", async () => {
    loadPermitExhibitMock.mockResolvedValue({ ok: false, error: { kind: "database_unavailable" } });
    const html = await render("17091190280000");
    expect(html).toMatch(/temporarily unavailable/);
  });
});

describe("Permit Exhibit page — empty-subject and proximity-only are honest, not failures", () => {
  it("renders the gate normally for a valid parcel with zero subject rows (never treated as an error)", async () => {
    accessCookieMock.mockReturnValue({ value: createShortlistAccessSession() });
    loadPermitExhibitMock.mockResolvedValue({
      ok: true,
      data: fixturePermitExhibit({ subject: [] }),
    });
    const html = await render("16111050040000");
    expect(html).toContain("SENSITIVE S1 SUBJECT ROWS");
    expect(html).not.toMatch(/temporarily unavailable/);
  });
});
