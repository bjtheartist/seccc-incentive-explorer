export const FIRST_VISIT_GUIDE_VERSION = 1;
export const FIRST_VISIT_GUIDE_STORAGE_KEY = "cie:first-visit-guide";
export const FIRST_VISIT_GUIDE_OPEN_EVENT = "cie:open-first-visit-guide";
export const FIRST_VISIT_SPOTLIGHT_OPEN_EVENT = "cie:open-first-visit-spotlight";
export const FIRST_VISIT_SPOTLIGHT_PENDING_KEY = "cie:first-visit-spotlight-pending";

/**
 * The tour's sample destination. `source=welcome_tour` also suppresses the
 * report email gate so the tour keeps its "does not ask for an email" promise.
 */
export const SAMPLE_REPORT_URL =
  "/report?instant=true&lat=41.73683&lon=-87.57776&addr=8701%20S%20Bennett%20Ave%2C%20Chicago%2C%20IL&source=welcome_tour";

export type FirstVisitGuideStatus = "completed" | "skipped";

/** Which segment of the cross-page spotlight run should start on arrival. */
export type SpotlightPendingLeg = "home" | "report" | "focus";

export interface FirstVisitGuidePreference {
  version: number;
  status: FirstVisitGuideStatus;
  updatedAt: string;
}

export interface FirstVisitGuideStep {
  eyebrow: string;
  title: string;
  description: string;
  takeaway: string;
  walkthroughKey: string;
}

export interface FirstVisitSpotlightStep {
  key: string;
  selector: string;
  title: string;
  description: string;
  side: "top" | "right" | "bottom" | "left";
  /** Overrides the popover's Next label (used on handoff steps). */
  nextBtnText?: string;
}

export const FIRST_VISIT_GUIDE_STEPS: FirstVisitGuideStep[] = [
  {
    eyebrow: "Start with a location",
    title: "Enter a Chicago address",
    description:
      "The address anchors the report to a real place so the Explorer can check public zoning, incentive geography, site, and nearby support data.",
    takeaway: "You can use a business address, a property you are considering, or a sample address.",
    walkthroughKey: "address-search",
  },
  {
    eyebrow: "Add project context",
    title: "Tell us what you are trying to do",
    description:
      "Choose up to three goals that describe the project, or write your own when the list does not fit. This keeps the report focused on the programs, questions, and support that are most relevant.",
    takeaway: "Goals can be refined later. They organize the report but do not determine final eligibility.",
    walkthroughKey: "project-goal",
  },
  {
    eyebrow: "Review the evidence",
    title: "See what the location may support",
    description:
      "The report organizes mapped programs, zoning context, public records, and local resources around the address, with source notes and verification links.",
    takeaway: "A likely match is a lead to investigate, not an award, approval, or zoning determination.",
    walkthroughKey: "report-findings",
  },
  {
    eyebrow: "Move the project forward",
    title: "Leave with clear next steps",
    description:
      "Use the report to verify program details, prepare the right documents, and connect with a local organization or program administrator when support would help.",
    takeaway: "The Explorer helps you arrive at the next conversation better prepared.",
    walkthroughKey: "next-steps",
  },
];

/**
 * Leg one: orient on the homepage, then hand off to the sample report.
 * Kept to three stops so the payoff (the report itself) arrives fast.
 */
export const SPOTLIGHT_HOME_STEPS: FirstVisitSpotlightStep[] = [
  {
    key: "address-search",
    selector: '[data-tour="address-search"]',
    title: "Start with a Chicago address",
    // The highlighted control is <AddressSearch />, which resolves a street
    // address or a business name only. It has no PIN branch, so naming one
    // here walked visitors into the "Address not found" error by following
    // the tour's own instruction.
    description:
      "A business address, a property you are considering, or a business name. The location anchors everything that follows to public records for that exact place.",
    side: "bottom",
  },
  {
    key: "project-paths",
    selector: '[data-tour="project-paths"]',
    title: "Three ways in",
    description:
      "Check a location, look for commercial space, or answer a few program-fit questions. Every path ends at the same place: a report you can act on.",
    side: "top",
  },
  {
    key: "sample-addresses",
    selector: '[data-tour="sample-addresses"]',
    title: "See a real snapshot first",
    description:
      "Next, the tour opens the report for a sample South Shore address so you can see what you get before entering your own. The examples are demonstrations, not eligibility determinations.",
    side: "top",
    nextBtnText: "Open the sample report",
  },
];

/**
 * Leg two: inside the sample report — the part of the product worth teaching.
 * Selectors lean on the report's stable section ids where they exist.
 */
export const SPOTLIGHT_REPORT_STEPS: FirstVisitSpotlightStep[] = [
  {
    key: "report-findings",
    selector: "#verdict",
    title: "Findings, in plain terms",
    description:
      "Mapped zones at the address and the programs linked to them. A likely match is a lead to verify, not an award, an approval, or a zoning determination.",
    side: "bottom",
  },
  {
    key: "report-refine",
    selector: '[data-tour="report-refine"]',
    title: "Organize it around your goals",
    description:
      "Choose up to three goals — remodel, hire, buy equipment — and the report rebuilds around them. Budget and timeline stay optional.",
    side: "bottom",
  },
  {
    key: "report-support",
    selector: '[data-tour="report-support"]',
    title: "Leave with someone to call",
    description:
      "Local organizations surfaced for this location, with source notes and verification links throughout. The goal is arriving at your next conversation prepared.",
    side: "bottom",
  },
];

export const SPOTLIGHT_TOTAL_STEPS =
  SPOTLIGHT_HOME_STEPS.length + SPOTLIGHT_REPORT_STEPS.length;

const AUTO_GUIDE_EXCLUSIONS = [
  "/admin",
  "/api",
  "/forgot-password",
  "/learn",
  "/login",
  "/print",
  "/report",
  "/reset-password",
  "/signup",
  "/workspace",
];

export function shouldAutoOpenFirstVisitGuide(pathname: string) {
  return !AUTO_GUIDE_EXCLUSIONS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Marks which spotlight leg should begin when its route finishes loading. */
export function writePendingSpotlightLeg(leg: SpotlightPendingLeg) {
  try {
    window.sessionStorage.setItem(FIRST_VISIT_SPOTLIGHT_PENDING_KEY, leg);
  } catch {
    // Client navigation still works when session storage is unavailable.
  }
}

/**
 * Reads the pending marker without consuming it. Effects peek first and only
 * consume at drive time, so React Strict Mode's mount → cleanup → remount
 * cycle cannot swallow a handoff. The legacy "true" value reads as "home".
 */
export function peekPendingSpotlightLeg(): SpotlightPendingLeg | null {
  try {
    const raw = window.sessionStorage.getItem(FIRST_VISIT_SPOTLIGHT_PENDING_KEY);
    const leg = raw === "true" ? "home" : raw;
    return leg === "home" || leg === "report" || leg === "focus" ? leg : null;
  } catch {
    return null;
  }
}

/**
 * Consumes the pending marker only when it matches the leg the caller can
 * start, so a "report" handoff survives an intermediate render of "/".
 * The legacy "true" value (pre-report-leg builds) reads as "home".
 */
export function takePendingSpotlightLeg(expected: SpotlightPendingLeg): boolean {
  try {
    const raw = window.sessionStorage.getItem(FIRST_VISIT_SPOTLIGHT_PENDING_KEY);
    const leg = raw === "true" ? "home" : raw;
    if (leg !== expected) return false;
    window.sessionStorage.removeItem(FIRST_VISIT_SPOTLIGHT_PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

export function readFirstVisitGuidePreference(
  storage: Pick<Storage, "getItem">,
): FirstVisitGuidePreference | null {
  try {
    const raw = storage.getItem(FIRST_VISIT_GUIDE_STORAGE_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<FirstVisitGuidePreference>;
    if (
      value.version !== FIRST_VISIT_GUIDE_VERSION ||
      (value.status !== "completed" && value.status !== "skipped") ||
      typeof value.updatedAt !== "string"
    ) {
      return null;
    }

    return value as FirstVisitGuidePreference;
  } catch {
    return null;
  }
}

export function writeFirstVisitGuidePreference(
  storage: Pick<Storage, "setItem">,
  status: FirstVisitGuideStatus,
) {
  const preference: FirstVisitGuidePreference = {
    version: FIRST_VISIT_GUIDE_VERSION,
    status,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(FIRST_VISIT_GUIDE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // The guide remains optional when storage is blocked or unavailable.
  }

  return preference;
}
