export const FIRST_VISIT_GUIDE_VERSION = 1;
export const FIRST_VISIT_GUIDE_STORAGE_KEY = "cie:first-visit-guide";
export const FIRST_VISIT_GUIDE_OPEN_EVENT = "cie:open-first-visit-guide";
export const FIRST_VISIT_SPOTLIGHT_OPEN_EVENT = "cie:open-first-visit-spotlight";
export const FIRST_VISIT_SPOTLIGHT_PENDING_KEY = "cie:first-visit-spotlight-pending";

export type FirstVisitGuideStatus = "completed" | "skipped";

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

export const FIRST_VISIT_SPOTLIGHT_STEPS: FirstVisitSpotlightStep[] = [
  {
    key: "address-search",
    selector: '[data-tour="address-search"]',
    title: "Start with a Chicago address",
    description:
      "Enter a business address, a property you are considering, or a PIN. The location anchors the public records and mapped program context in the report.",
    side: "bottom",
  },
  {
    key: "project-paths",
    selector: '[data-tour="project-paths"]',
    title: "Choose the path that fits your goal",
    description:
      "Check a location, look for commercial space, or answer a few program-fit questions. You can refine the project later.",
    side: "bottom",
  },
  {
    key: "sample-addresses",
    selector: '[data-tour="sample-addresses"]',
    title: "Try the workflow without an address",
    description:
      "Use a sample Chicago location to see the report experience. The examples are demonstrations, not eligibility determinations.",
    side: "bottom",
  },
  {
    key: "report-preview",
    selector: '[data-tour="report-preview"]',
    title: "Review findings and decide what to verify",
    description:
      "A location snapshot organizes mapped programs, zoning context, vacancy signals, and nearby support. Follow its source notes and verification links before acting.",
    side: "left",
  },
];

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
