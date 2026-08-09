import { describe, expect, it } from "vitest";
import {
  FIRST_VISIT_GUIDE_STEPS,
  FIRST_VISIT_GUIDE_STORAGE_KEY,
  FIRST_VISIT_GUIDE_VERSION,
  FIRST_VISIT_SPOTLIGHT_STEPS,
  readFirstVisitGuidePreference,
  shouldAutoOpenFirstVisitGuide,
  writeFirstVisitGuidePreference,
} from "@/lib/first-visit-guide";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: (key: string) => (key === FIRST_VISIT_GUIDE_STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => {
      if (key === FIRST_VISIT_GUIDE_STORAGE_KEY) value = next;
    },
    current: () => value,
  };
}

describe("first visit guide preference", () => {
  it("persists a versioned completion without collecting identity", () => {
    const storage = memoryStorage();
    const preference = writeFirstVisitGuidePreference(storage, "completed");

    expect(preference.version).toBe(FIRST_VISIT_GUIDE_VERSION);
    expect(preference.status).toBe("completed");
    expect(JSON.parse(storage.current() || "{}")).toEqual(preference);
    expect(storage.current()).not.toContain("email");
  });

  it("recognizes completed and skipped preferences for the current version", () => {
    for (const status of ["completed", "skipped"] as const) {
      const storage = memoryStorage(
        JSON.stringify({
          version: FIRST_VISIT_GUIDE_VERSION,
          status,
          updatedAt: "2026-08-08T12:00:00.000Z",
        }),
      );
      expect(readFirstVisitGuidePreference(storage)?.status).toBe(status);
    }
  });

  it("reopens after a version change and tolerates malformed or blocked storage", () => {
    const old = memoryStorage(
      JSON.stringify({ version: FIRST_VISIT_GUIDE_VERSION - 1, status: "completed", updatedAt: "x" }),
    );
    expect(readFirstVisitGuidePreference(old)).toBeNull();
    expect(readFirstVisitGuidePreference(memoryStorage("not-json"))).toBeNull();
    expect(
      readFirstVisitGuidePreference({
        getItem() {
          throw new Error("storage blocked");
        },
      }),
    ).toBeNull();
  });
});

describe("first visit guide placement", () => {
  it("auto-opens on public discovery routes", () => {
    for (const pathname of ["/", "/map", "/programs", "/vacancy/60617/cases"]) {
      expect(shouldAutoOpenFirstVisitGuide(pathname)).toBe(true);
    }
  });

  it("stays out of learning, reports, authentication, workspaces, and admin tools", () => {
    for (const pathname of ["/learn", "/report", "/report/abc", "/login", "/workspace/projects/1", "/admin"]) {
      expect(shouldAutoOpenFirstVisitGuide(pathname)).toBe(false);
    }
  });

  it("provides a stable media key for each future walkthrough segment", () => {
    expect(FIRST_VISIT_GUIDE_STEPS).toHaveLength(4);
    expect(new Set(FIRST_VISIT_GUIDE_STEPS.map((step) => step.walkthroughKey)).size).toBe(4);
  });

  it("defines unique, source-honest targets for the live spotlight tour", () => {
    expect(FIRST_VISIT_SPOTLIGHT_STEPS).toHaveLength(4);
    expect(new Set(FIRST_VISIT_SPOTLIGHT_STEPS.map((step) => step.key)).size).toBe(4);
    expect(new Set(FIRST_VISIT_SPOTLIGHT_STEPS.map((step) => step.selector)).size).toBe(4);

    const copy = FIRST_VISIT_SPOTLIGHT_STEPS.map((step) => step.description).join(" ");
    expect(copy).toContain("public records");
    expect(copy).toContain("not eligibility determinations");
    expect(copy).toContain("verification links");
    expect(copy).not.toMatch(/\$\d|\d{2,}\+|\d+ programs|official determination/i);
  });
});
