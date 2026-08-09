export const FIRST_VISIT_GUIDE_VERSION = 1;
export const FIRST_VISIT_GUIDE_STORAGE_KEY = "cie:first-visit-guide";
export const FIRST_VISIT_GUIDE_OPEN_EVENT = "cie:open-first-visit-guide";

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
      "Choose the primary goal that best describes the project. This keeps the report focused on the programs, questions, and support that are most relevant.",
    takeaway: "The goal can be refined later. It does not determine final eligibility.",
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

const AUTO_GUIDE_EXCLUSIONS = [
  "/admin",
  "/api",
  "/forgot-password",
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
