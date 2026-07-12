import { isSnapshotWizardState } from "@/lib/report-wizard-config";
import type { WizardState } from "@/lib/report-wizard-config";

/**
 * RF1 (confirmed, 2026-07-10 report-workflow audit): the saved-report
 * Workspace page never passed `isInstantMode` to <ReportDisplay>, and the
 * button that renders "Refine with Project Details" gates on that prop —
 * so refine was dead code on every saved Workspace report. There's no
 * explicit "was this an instant snapshot" flag stored with a saved report,
 * so derive it the same way the instant flow itself builds wizard state
 * (see MapView/AddressSearch): a bare site-incentives lookup with none of
 * the refine-only project-detail fields filled in yet.
 *
 * Delegates to isSnapshotWizardState (lib/report-wizard-config) — the single
 * source of truth for "is this wizard state a location-only snapshot",
 * shared with the refine value panel work. Kept as an export so callers and
 * the RF1 regression tests keep a workspace-scoped name.
 */
export function deriveIsInstantMode(wizardState: WizardState | undefined): boolean {
  return isSnapshotWizardState(wizardState);
}

/**
 * Tier 1b (BM4): should a saved report show the persona lens chips?
 * Deliberately broader than deriveIsInstantMode — persona (audience) and goal
 * (project outcome) are orthogonal lenses, so the chips stay available on
 * goal-refined site reports, not just bare location snapshots. This mirrors
 * the live /report flow, which gates the chips on page-level instant mode
 * regardless of whether the email gate produced a goal-refined report.
 */
export function derivePersonaLensVisible(
  wizardState: WizardState | undefined,
): boolean {
  return wizardState?.reportType === "site-incentives";
}

export const GOAL_OPTIONS = [
  { id: "improve-storefront", label: "Improve storefront" },
  { id: "buy-equipment", label: "Buy equipment" },
  { id: "hire-staff", label: "Hire staff" },
  { id: "expand-location", label: "Expand current location" },
  { id: "open-relocate", label: "Open or relocate" },
  { id: "acquire-vacant-property", label: "Acquire vacant property" },
  { id: "development-feasibility", label: "Evaluate vacancy opportunity" },
] as const;

export type GoalType = (typeof GOAL_OPTIONS)[number]["id"];

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface BusinessProject {
  id: string;
  goalType: GoalType;
  goalLabel: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  industry: string | null;
  budgetRange: string | null;
  status: string;
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SavedReportSummary {
  id: string;
  projectId: string | null;
  title: string;
  reportType: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedReportDetail extends SavedReportSummary {
  wizardState: unknown;
  reportData: unknown;
}

const CHECKLISTS: Record<GoalType, string[]> = {
  "improve-storefront": [
    "Confirm lease or ownership documents",
    "Define improvement scope and budget",
    "Collect contractor estimates",
    "Review matching grant and corridor program fit",
    "Schedule a conversation with a business support partner",
  ],
  "buy-equipment": [
    "List equipment needed and estimated cost",
    "Confirm whether the purchase supports growth or retention",
    "Gather vendor quotes",
    "Review financing, tax credit, and grant options",
    "Prepare financial documents for a lender or advisor",
  ],
  "hire-staff": [
    "Define roles, wages, and hiring timeline",
    "Estimate new jobs or retained jobs",
    "Review workforce and hiring incentive fit",
    "Gather payroll or employment records",
    "Contact a workforce or business support partner",
  ],
  "expand-location": [
    "Document current space constraints",
    "Confirm zoning and parcel context",
    "Estimate buildout or relocation budget",
    "Review location-based incentives",
    "Bring the report to a lender or local support partner",
  ],
  "open-relocate": [
    "Compare possible addresses or corridors",
    "Confirm zoning and permitted use",
    "Estimate startup, buildout, and equipment costs",
    "Review incentive zones and county-wide programs",
    "Choose next site visits and partner follow-ups",
  ],
  "acquire-vacant-property": [
    "Confirm property ownership and PIN",
    "Review zoning, parcel, and vacancy context",
    "Estimate acquisition and development costs",
    "Check Land Bank, city-owned land, and financing options",
    "Prepare questions for the property owner or program contact",
  ],
  "development-feasibility": [
    "Confirm project type and target location",
    "Review zoning, parcel, and census context",
    "Estimate total project cost",
    "Identify credits or incentives to analyze",
    "Share the vacancy report with financing or development partners",
  ],
};

export function isGoalType(value: unknown): value is GoalType {
  return GOAL_OPTIONS.some((goal) => goal.id === value);
}

export function goalLabel(goalType: GoalType): string {
  return GOAL_OPTIONS.find((goal) => goal.id === goalType)?.label || goalType;
}

export function buildChecklist(goalType: GoalType): ChecklistItem[] {
  return CHECKLISTS[goalType].map((label, index) => ({
    id: `${goalType}-${index + 1}`,
    label,
    completed: false,
  }));
}

export function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Partial<ChecklistItem>;
      if (typeof raw.label !== "string") return null;
      return {
        id: typeof raw.id === "string" ? raw.id : `item-${index + 1}`,
        label: raw.label,
        completed: raw.completed === true,
      };
    })
    .filter((item): item is ChecklistItem => item !== null);
}
