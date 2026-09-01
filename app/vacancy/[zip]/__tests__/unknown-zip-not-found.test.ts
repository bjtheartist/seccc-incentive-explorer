import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unknown-ZIP rejection for the three parameterized vacancy routes.
 *
 * `/vacancy/[zip]`, `/vacancy/[zip]/report` and `/vacancy/[zip]/shortlist` each
 * open with `if (!getPilotZipEntry(zip)) notFound()`, but nothing pinned it:
 * the existing suites for these pages all render a KNOWN pilot ZIP, so a
 * dropped guard would have fallen through to the data loaders on an arbitrary
 * caller-supplied ZIP and rendered an empty-but-real page for a neighborhood
 * the pilot does not cover. Follows the permit-exhibit snapshots pattern
 * (app/permit-exhibit/snapshots/[snapshotId]/__tests__/page.test.tsx): mock
 * notFound() to throw, assert the throw, and assert no data load happened.
 *
 * `getPilotZipEntry` is left REAL — the point is that a ZIP outside the pilot
 * roster is rejected, so stubbing the roster would test nothing.
 */

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, notFound: notFoundMock };
});

// Data loaders — spies so we can prove the guard runs BEFORE any load.
const { buildCaseRecordsMock, loadVacancyIndexMock, loadShortlistUniverseMock } = vi.hoisted(() => ({
  buildCaseRecordsMock: vi.fn(() => ({ records: [], recordsAsOf: null, universe: "all" })),
  loadVacancyIndexMock: vi.fn(() => null),
  loadShortlistUniverseMock: vi.fn(),
}));

vi.mock("@/lib/vacancy-cases-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vacancy-cases-data")>();
  return { ...actual, buildCaseRecords: buildCaseRecordsMock };
});

vi.mock("@/lib/vacancy-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vacancy-index")>();
  return { ...actual, loadVacancyIndex: loadVacancyIndexMock };
});

// Client islands — stub so importing the pages never pulls in mapbox / jsPDF.
vi.mock("@/components/vacancy/VacancyMapIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyClustersIsland", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancyDirectory", () => ({ default: () => null }));
vi.mock("@/components/vacancy/CaseWorkspace", () => ({ default: () => null }));
vi.mock("@/components/vacancy/VacancySubNav", () => ({ VacancySubNav: () => null }));
vi.mock("@/components/owner-file/VacancyIndexPdfButton", () => ({
  VacancyIndexPdfButton: () => null,
}));

const UNKNOWN_ZIP = "99999";

const [{ default: WorkbenchPage }, { default: ReportPage }, { default: ShortlistPage }] =
  await Promise.all([
    import("../page"),
    import("../report/page"),
    import("../shortlist/page"),
  ]);

const ROUTES = [
  {
    label: "/vacancy/[zip]",
    render: () =>
      WorkbenchPage({
        params: Promise.resolve({ zip: UNKNOWN_ZIP }),
        searchParams: Promise.resolve({}),
      } as never),
  },
  {
    label: "/vacancy/[zip]/report",
    render: () =>
      ReportPage({
        params: Promise.resolve({ zip: UNKNOWN_ZIP }),
        searchParams: Promise.resolve({}),
      } as never),
  },
  {
    label: "/vacancy/[zip]/shortlist",
    render: () =>
      ShortlistPage({
        params: Promise.resolve({ zip: UNKNOWN_ZIP }),
        searchParams: Promise.resolve({}),
      } as never),
  },
] as const;

describe("vacancy routes reject a ZIP outside the pilot roster", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    buildCaseRecordsMock.mockClear();
    loadVacancyIndexMock.mockClear();
    loadShortlistUniverseMock.mockClear();
  });

  it.each(ROUTES)("$label routes an unknown ZIP to not-found", async ({ render }) => {
    await expect(Promise.resolve().then(render)).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalled();
    // The guard fires before the page reaches any vacancy data source.
    expect(buildCaseRecordsMock).not.toHaveBeenCalled();
    expect(loadVacancyIndexMock).not.toHaveBeenCalled();
  });
});
