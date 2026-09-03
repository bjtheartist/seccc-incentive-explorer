"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Search,
  MapPin,
  FileText,
  Loader2,
  RotateCcw,
  Printer,
  ExternalLink,
} from "lucide-react";
import { encodeWizardState } from "@/lib/url-state";
import { selectedProjectGoalLabels } from "@/lib/report-wizard-config";
import type { WizardState } from "@/lib/report-wizard-config";
import {
  CONFIRMED_PROGRAMS_SECTION_ID,
  normalizePublicReportForDisplay,
  SECTION_IDS,
  sectionMatchesIdOrTitle,
  type GeneratedReport,
  type ReportSection,
  type ReportItem,
} from "@/lib/report-engine";
import ReportZoningMap from "@/components/report/ReportZoningMapIsland";
import { RefineValuePanel } from "@/components/report/RefineValuePanel";
import type {
  QuickRefineFields,
  RefinePanelContext,
} from "@/components/report/RefineValuePanel";
import { ReportActionButtons } from "@/components/report/ReportActionButtons";
import { StartHereCard } from "@/components/report/StartHereCard";
import { ActionRoadmapSection } from "@/components/report/ActionRoadmapSection";
import {
  DownloadGateModal,
  EmailReportModal,
} from "@/components/report/ReportModals";
import {
  FreshnessBadge,
  ReportNavigationLinks,
  type ReportNavigationItem,
} from "@/components/report/ReportNavigationLinks";
import {
  ExecutiveSummarySection,
  MatchExplanationDetails,
  VerdictCard,
} from "@/components/report/ExecutiveSummarySection";
import {
  buildTableCsv,
  downloadCsv,
  slugifyFilePart,
} from "@/lib/vacancy-spreadsheet";
import { useVacancySpreadsheetSection } from "@/components/report/useVacancySpreadsheetSection";
import {
  DrawnAreaScopeUnavailableBanner,
  VacancySpreadsheetCsvCtaButton,
  VacancySpreadsheetSection,
  VacancySpreadsheetSummaryCard,
} from "@/components/report/VacancySpreadsheetSection";
import {
  AnchorCards,
  ComparisonBar,
  EconomicSignalCards,
  visibleSectionItems,
} from "@/components/report/NeighborhoodEconomics";
import { ZoningReviewQuestions } from "@/components/zoning/ZoningReviewQuestions";
import { ZoningStarterHandoff } from "@/components/zoning/ZoningStarterHandoff";
import {
  PreparationCostBadge,
  parseDocumentCostLine,
} from "@/components/report/PreparationCostBadge";
import { PersonaChips } from "@/components/report/PersonaChips";
import { applyPersonaLens, guidepostPartForSection, type GuidepostPart } from "@/lib/report-personas";
import { ContactSheet } from "@/components/report/ContactSheet";
import { ContactSheetPointerRow } from "@/components/report/ContactSheetPointerRow";
import { ProgramCardExtras } from "@/components/report/ProgramCardExtras";
import { ProgramRoutingCard, ProgramRoutingViewNote } from "@/components/report/ProgramRoutingCard";
import { ReasonChips } from "@/components/report/ReasonChips";
import { ProgramCardFace } from "@/components/report/ProgramCardFace";
import {
  WhatsNotablePanel,
  ExploreByInterestPanel,
} from "@/components/report/LookingOverview";
import {
  isRealPersona,
  PersonaAlsoAtAddress,
  PersonaExecutiveSummary,
  PersonaGuidepostBand,
  PersonaReportFooter,
  PersonaReportHeader,
} from "@/components/report/PersonaReportChrome";
import {
  PersonaNeighborhoodSupplement,
  PersonaProgramSupplements,
  personaContactSectionNumber,
  personaProgramSupplementCount,
} from "@/components/report/PersonaSectionSupplements";
import { BriefStageAsk } from "@/components/report/BriefStageAsk";
import { BriefPage } from "@/components/report/BriefPage";
import {
  DEFAULT_BRIEF_UI_STATE,
  isBriefPriority,
  isBriefStage,
  type BriefUiState,
} from "@/lib/report-brief";
import {
  DEFAULT_PERSONA,
  personaFromSearch,
  personaLabel,
  personaShareParam,
  resolveInitialPersona,
  storePersona,
  type PersonaId,
} from "@/lib/personas";
import { GroupedReportDetail } from "@/components/report/GroupedReportDetail";
import { CapitalPartnerHandoff } from "@/components/report/CapitalPartnerHandoff";
import { CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE } from "@/lib/capital-partner-report";
import {
  isSupportOrganizationSectionTitle,
  SUPPORT_ORGANIZATIONS_CAPACITY_NOTE,
  SUPPORT_ORGANIZATIONS_DESCRIPTION,
  SUPPORT_ORGANIZATIONS_SECTION_TITLE,
} from "@/lib/support-organization-copy";
import { StartPreparationPacketButton } from "@/components/incentive-preparation/StartPreparationPacketButton";
import { SaveReportModal } from "@/components/workspace/SaveReportModal";
import { storePendingReport } from "@/components/workspace/PendingReportSaver";
import { WatchAreaButton } from "@/components/workspace/WatchAreaButton";
import { AdminOwnershipPanel } from "@/components/report/AdminOwnershipPanel";
import type { AdminOwnershipPanelStatus } from "@/components/report/AdminOwnershipPanel";
import { fetchAdminOwnershipContext } from "@/lib/owner-file-report-context";
import type {
  OwnerFileReportMatch,
  OwnerFileReportTopCluster,
} from "@/lib/owner-file-report-context";
import { REPORT_GENERATION_FAILURE_COPY } from "@/components/report/report-generation-failure";
import { trackEvent } from "@/lib/analytics-events";
import {
  analyticsReportKey,
  extractReportZipCode,
  reportAnalyticsPayload,
} from "@/lib/report-generated-event";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

const fadeIn = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

/**
 * Compact local-support strip under the verdict — elevates the support
 * network (normally buried mid-report) to the top of the page. Clicks run
 * through the same support_resource_clicked tracking as the full section.
 *
 * Live surface only (`surface="live"`), alongside the fuller support hero
 * band below it. Moved here verbatim from app/report/page.tsx when the two
 * report renderers were merged — see docs/report-renderer-unification.md
 * section 3.4. `data-tour="report-support"` is the spotlight tour's anchor.
 */
function VerdictPartnerStrip({
  items,
  onPartnerClick,
}: {
  items: ReportItem[];
  onPartnerClick: (item: ReportItem) => void;
}) {
  if (items.length === 0) return null;
  const top = items.slice(0, 3);

  return (
    <div
      data-tour="report-support"
      className="mb-12 border border-[#0C1B33]/10 bg-[#EFF3FB]/70 px-5 py-4 print:hidden"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]">
          Local support to explore
        </span>
        <span className="text-[12px] text-[#0C1B33]/50">
          {items.length} organization{items.length !== 1 ? "s" : ""} selected for this location
        </span>
        <a
          href="#your-support-network"
          className="ml-auto font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/45 hover:text-[#2563EB] transition-colors"
        >
          See all ↓
        </a>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {top.map((item) =>
          item.url ? (
            <a
              key={item.label}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onPartnerClick(item)}
              className="inline-flex items-center gap-1.5 bg-white border border-[#0C1B33]/12 px-3 py-1.5 text-[12px] text-[#0C1B33]/75 hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
            >
              {item.label}
              <ExternalLink className="w-3 h-3 opacity-40" />
            </a>
          ) : (
            <span
              key={item.label}
              className="inline-flex items-center bg-white border border-[#0C1B33]/12 px-3 py-1.5 text-[12px] text-[#0C1B33]/70"
            >
              {item.label}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

// ─── Report Display ──────────────────────────────────────────────────

/**
 * THE report renderer. One component, two surfaces.
 *
 * Until the fork-unification round this UI existed twice: this exported
 * component (rendering saved reports at /workspace/reports/[id]) and a
 * private `ReportDisplay` inside app/report/page.tsx (rendering the live
 * /report result and its two compare panes). They were hand-maintained
 * copies — 1,275 byte-identical lines at the last measurement, ratcheted by
 * lib/source-guard/fork-similarity-ratchet.ts — and they had drifted, in
 * both directions, on screen and in the funnel.
 *
 * The private copy is gone; /report imports this. Everything the two forks
 * genuinely did differently is now derived from ONE prop, `surface`, in the
 * block at the top of the body. Every classification — which difference was
 * drift and which was a real per-surface feature, and which fork won each —
 * is written down in docs/report-renderer-unification.md. Read that before
 * adding a per-surface branch: a second mode prop, or a `className` escape
 * hatch, is how this became two files the first time.
 */
export function ReportDisplay({
  report: rawReport,
  onStartOver,
  onRefine,
  onQuickRefine,
  quickRefineBusy,
  refineContext: refineContextProp,
  isInstantMode,
  showPersonaLens,
  persona: personaProp,
  onPersonaSelect,
  wizardState: reportWizardState,
  compact,
  onCompare,
  compareMode,
  compareAddressInput,
  setCompareAddressInput,
  compareGeocoding,
  onCompareGeocode,
  comparisonFailed,
  compareGeoResult,
  surface = "saved",
  analyticsSource: analyticsSourceProp,
}: {
  report: GeneratedReport;
  onStartOver: () => void;
  onRefine?: () => void;
  /**
   * Inline goal-first quick refine inside RefineValuePanel. Live surface
   * only — a saved report has no wizard to re-run in place.
   */
  onQuickRefine?: (fields: QuickRefineFields) => void;
  quickRefineBusy?: boolean;
  /**
   * Entry-point label RefineValuePanel records its own exposure event
   * under. Defaults per surface to what each fork used before the merge:
   * a compare pane is "compare_a", the live report "instant", a saved
   * report "workspace".
   */
  refineContext?: RefinePanelContext;
  isInstantMode?: boolean;
  /**
   * Persona lens visibility (Tier 1b, BM4). Deliberately decoupled from
   * isInstantMode: the live page passes isInstantMode diminished by
   * hasRefinedInstantReport (hiding the refine pitch after refining is
   * intentional) and a saved report is snapshot-only, but persona
   * (audience) and goal (project outcome) are orthogonal — the lens must
   * stay available on the goal-refined report the email gate funnels every
   * real user into, and on any location-anchored saved site report.
   */
  showPersonaLens?: boolean;
  /**
   * Persona lens value + committer, CONTROLLED when `persona` is supplied.
   *
   * /report lifts this state to `ReportWizardPage` (gate-persona-lens-sunset
   * round) so `ReportEmailGate` — a SIBLING of this component, not a child —
   * can commit a persona choice into the same value this renders from.
   * Saved reports have no such sibling, so omitting `persona` leaves this
   * component owning it: it resolves `?persona=` / the stored session choice
   * after mount and calls `storePersona` on every selection. See
   * docs/report-renderer-unification.md section 4.
   */
  persona?: PersonaId;
  onPersonaSelect?: (next: PersonaId) => void;
  wizardState?: WizardState;
  compact?: boolean;
  onCompare?: () => void;
  compareMode?: boolean;
  compareAddressInput?: string;
  setCompareAddressInput?: (v: string) => void;
  compareGeocoding?: boolean;
  onCompareGeocode?: () => void;
  /**
   * R1 finding 1: a failed comparison generation used to leave the compare
   * panel spinning with nothing said. True when that generation failed; the
   * panel then states it and offers the same lookup again (re-running the
   * compare geocode re-arms the generation effect, which is the SAME path).
   * Compare is a live-surface flow; a saved report never sets this.
   */
  comparisonFailed?: boolean;
  compareGeoResult?: { lat: number; lon: number; display_name: string } | null;
  // review7 S20 (MEDIUM): `programs?: Program[]` removed — see
  // ReportNavigationLinks.tsx's own comment on why it was already dead
  // (no real caller ever populated it; `programReportItem()` already
  // sets every field the `programById` lookup below used to fall back
  // to, confirmed during review6 S11).
  /**
   * WHICH REPORT SURFACE THIS IS. The one seam left by the fork merge.
   *
   * "live"  — /report: the wizard's own result and its two compare panes.
   * "saved" — a stored snapshot (/workspace/reports/[id]) and the default,
   *           so every existing caller and test keeps today's behavior.
   *
   * Five reader-visible differences derive from this, in ONE block at the
   * top of the body. Do not add a second mode prop or a className escape
   * hatch: that is how this component became two files the first time.
   * docs/report-renderer-unification.md section 3 lists all five with the
   * evidence for keeping each.
   */
  surface?: "live" | "saved";
  /** Entry-point label used on refine/save/email instrumentation (Tier 0 audit). */
  analyticsSource?: string;
}) {
  // ── Surface differences (the whole of them) ──────────────────────────
  // Each line below is one reader-visible way /report and a saved report
  // differ, and each is what the corresponding fork rendered before the
  // merge. docs/report-renderer-unification.md section 3 carries the
  // evidence and the test that pins each.
  const isLiveSurface = surface === "live";
  /** 3.1 Sections collapse past the first two, behind an Expand/Collapse head. */
  const progressiveDisclosure = isLiveSurface;
  /** 3.2 Probe the Owner Files admin session and mount AdminOwnershipPanel. */
  const showAdminOwnership = isLiveSurface;
  /** 3.3 + 3.4 Support hero band above the TOC, partner strip under the verdict. */
  const elevateSupportNetwork = isLiveSurface;
  /** 3.5 The download gate offers a skip path. */
  const allowDownloadGateSkip = isLiveSurface;
  /** 3.6 The action row's afterSave slot carries a Watch Area control. */
  const showWatchAreaAction = !isLiveSurface;
  // Both forks' defaults, preserved exactly, now derived rather than
  // hand-copied into two files.
  const analyticsSource = analyticsSourceProp ?? (isLiveSurface ? "instant_report" : "workspace");
  const refineContext =
    refineContextProp ?? (compact ? "compare_a" : isLiveSurface ? "instant" : "workspace");

  const report = useMemo(() => normalizePublicReportForDisplay(rawReport), [rawReport]);
  const { status } = useSession();
  const [linkCopied, setLinkCopied] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const vacancy = useVacancySpreadsheetSection(report, reportWizardState, compact);
  const { vacancySpreadsheetScope, isDrawnAreaReport, vacancySpreadsheetLocale } = vacancy;
  const [editedSummaryText, setEditedSummaryText] = useState(
    report.executiveSummary?.whyTheseMatter || ""
  );
  // review6 S11 (CRITICAL, S1 reopened): the `programById` fallback map
  // that used to live here (built from a client-side `programs: Program[]`
  // prop) is gone. `programReportItem()` (lib/report-engine.ts) already
  // sets applicationPortals/verificationSteps/sourceUrl/status directly on
  // every program-linked report item at generation time — this was
  // always the PRIMARY source (see ReportNavigationLinks's own
  // `item.applicationPortals || program?.applicationPortals` fallback
  // ordering); losing the secondary fallback only affects a report item
  // built through some OTHER path that didn't set those fields itself.
  const supportSection = useMemo(
    () => report.sections?.find((section) => isSupportOrganizationSectionTitle(section.title)) ?? null,
    [report.sections],
  );
  const supportItems = useMemo(
    () => supportSection?.items.slice(1) ?? [],
    [supportSection],
  );
  // The hero band's "Visit {org}" CTA (live surface only, section 3.3).
  const supportCtaItem = useMemo(
    () => supportItems.find((item) => item.sourceUrl || item.url) ?? null,
    [supportItems],
  );
  const supportCtaUrl = supportCtaItem?.sourceUrl || supportCtaItem?.url;
  const viewedSupportKeyRef = useRef<string | null>(null);

  // ── Persona lens (Tier 1b, audit BM4) ──
  // A viewing lens over this snapshot: re-orders and collapses existing content
  // client-side. Canonical `report` stays untouched (save/email/PDF/refine use
  // it); only the on-screen sections + roadmap read the lensed copy.
  //
  // Controlled when the caller supplies `persona` (see the prop's own doc);
  // otherwise this slot owns it. The useState and the resolve effect run
  // unconditionally either way — a conditional hook would break the ordinal
  // seeding in app/report/__tests__/report-page-live-renderer.test.tsx as
  // surely as it would break React.
  const isPersonaControlled = personaProp !== undefined;
  const [uncontrolledPersona, setUncontrolledPersona] = useState<PersonaId>(DEFAULT_PERSONA);
  const persona = personaProp ?? uncontrolledPersona;
  useEffect(() => {
    if (isPersonaControlled) return;
    // Resolve after mount to avoid a hydration mismatch; a forwarded ?persona=
    // (or the per-session choice) opens the snapshot in that lens.
    setUncontrolledPersona(
      resolveInitialPersona(
        typeof window !== "undefined" ? window.location.search : null,
      ),
    );
  }, [isPersonaControlled]);
  const handlePersonaSelect = useCallback(
    (next: PersonaId) => {
      if (isPersonaControlled) {
        // The owner of the state is a level up; it stores the choice itself.
        onPersonaSelect?.(next);
        return;
      }
      setUncontrolledPersona(next);
      storePersona(next);
    },
    [isPersonaControlled, onPersonaSelect],
  );
  // Shared-link recipient experience (spec v2 deliverable 7): a framed link
  // opens in the sender's chosen lens. Derived at render time (not its own
  // state — avoids adding a useState slot, which would desync the
  // ordinal-seeded test harness; see report-page-live-renderer.test.tsx's
  // maintenance warning) from the same URL the persona-resolution effect
  // above already reads.
  const isFramedPersonaLink =
    typeof window !== "undefined" && personaFromSearch(window.location.search) !== DEFAULT_PERSONA;
  const lensed = useMemo(
    // Without visible chips there must be no invisible lens: a stored session
    // persona must never silently reorder a report that can't show the row.
    () => (showPersonaLens ? applyPersonaLens(report, persona).report : report),
    [report, persona, showPersonaLens],
  );
  const boardPersona = showPersonaLens && isRealPersona(persona) ? persona : null;
  const showPersonaView = boardPersona !== null;
  // Tracks the last guidepost PART band emitted by the section-render loop
  // below — see the live fork (app/report/page.tsx) for the full rationale.
  let guidepostBandTracker: GuidepostPart | null = boardPersona === "looking" ? 1 : null;
  // Running count of NUMBERED sections/mounts the persona board has actually
  // rendered — see the live fork (app/report/page.tsx) for the full rationale.
  let personaSectionCounter = boardPersona === "looking" ? 1 : 0;

  // ── TOC ──
  // Gate finding 19: id-first (see app/report/page.tsx's fuller rationale)
  // — a title-only anchor would have silently changed the rendered anchor
  // id out from under every TOC link/deep-link the moment gate finding
  // 19's per-persona title overrides landed.
  const sectionToAnchor = (section: ReportSection) =>
    isSupportOrganizationSectionTitle(section.title)
      ? "your-support-network"
      : section.id ?? section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /** Stable identity for a section's UI state — see the live fork
   *  (app/report/page.tsx) for the full rationale (adversarial review
   *  finding #9: index-keyed state desyncs when the persona lens reorders
   *  `lensed.sections`). Identical to sectionToAnchor since gate finding
   *  19 (both are id-first); kept as a separate name for readability. */
  const sectionStateKey = (section: ReportSection) => sectionToAnchor(section);
  const personaProgramsAnchor =
    lensed.sections?.find(
      (section) => !section.collapsedByPersona && section.guidepostBucket === "programs",
    )
      ? sectionToAnchor(
          lensed.sections.find(
            (section) => !section.collapsedByPersona && section.guidepostBucket === "programs",
          )!,
        )
      : "";

  // Guidepost band (spec v2 visual law) — see the live fork
  // (app/report/page.tsx) for the full rationale.
  const renderGuidepostBand = (part: GuidepostPart) => (
    <PersonaGuidepostBand key={`guidepost-part-${part}`} part={part} />
  );

  // TOC derives from the LENSED report (spec v2 build order item 3): a
  // persona-reordered body with a canonical-order TOC pointed readers at the
  // wrong anchor position.
  const tocEntries = useMemo(() => {
    const entries: { label: string; anchor: string }[] = [];
    if (lensed.verdict) entries.push({ label: "Location Findings", anchor: "verdict" });
    if (lensed.executiveSummary) entries.push({ label: "Executive Summary", anchor: "executive-summary" });
    if (lensed.actionRoadmap && lensed.actionRoadmap.length > 0) entries.push({ label: "Your Next Steps", anchor: "action-roadmap" });
    if (lensed.sections) {
      for (const s of lensed.sections) {
        entries.push({ label: s.title, anchor: sectionToAnchor(s) });
      }
    }
    if (lensed.recommendedActions && lensed.recommendedActions.length > 0) entries.push({ label: "Recommended Actions", anchor: "recommended-actions" });
    if (lensed.dataSources && lensed.dataSources.length > 0) entries.push({ label: "Data Sources", anchor: "data-sources" });
    return entries;
  }, [lensed]);

  /* ── Progressive disclosure (LIVE surface only — see the `surface` prop
        and docs/report-renderer-unification.md section 3.1): long-tail
        sections collapse by default. Open: the first two sections plus the
        primary-story sections. Content stays in the DOM (CSS-hidden) so
        print and #anchors work. A saved report renders every section open,
        with no expand affordance, exactly as it always has. ── */
  const ALWAYS_OPEN_SECTIONS = useMemo(
    () => new Set(["Programs Mapped at This Address", SUPPORT_ORGANIZATIONS_SECTION_TITLE]),
    []
  );
  // Keyed by sectionStateKey (section.id, falling back to the title
  // anchor) — NOT array index. The persona lens reorders `lensed.sections`
  // on every persona switch; an index-keyed map silently reattached a prior
  // section's open/closed state to whatever different section now sits at
  // that position (adversarial review finding #9).
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const isSectionOpen = useCallback(
    (key: string, idx: number, title: string) =>
      expandedSections[key] ?? (idx < 2 || ALWAYS_OPEN_SECTIONS.has(title)),
    [expandedSections, ALWAYS_OPEN_SECTIONS]
  );
  useEffect(() => {
    // Auto-expand a collapsed section when a TOC/anchor link targets it.
    // Reads `lensed` (not canonical `report`) so a hash link opens the
    // section that's actually rendered under the active persona. Inert
    // where nothing collapses in the first place.
    if (!progressiveDisclosure) return;
    const openFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash || !lensed.sections) return;
      const target = lensed.sections.find(
        (s) => sectionToAnchor(s) === hash
      );
      if (target) setExpandedSections((prev) => ({ ...prev, [sectionStateKey(target)]: true }));
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [lensed.sections, progressiveDisclosure]);

  const [downloadGateOpen, setDownloadGateOpen] = useState(false);
  // The Brief (gate finding 8, spec v2 item 5): one state slot for the
  // two-question ask + open/closed, so this only adds ONE ordinal useState
  // slot. See report-page-live-renderer.test.tsx's maintenance warning —
  // that harness seeds this component's useState calls by ordinal.
  const [briefState, setBriefState] = useState<BriefUiState>(DEFAULT_BRIEF_UI_STATE);

  /* ── Admin-only ownership context (LIVE surface only, screen-only; never
        PDF/email — see components/report/AdminOwnershipPanel.tsx). Probes
        the Owner Files admin session once, then loads the private
        per-parcel geo export for this report's ZIP only when the probe
        confirms an admin session. ── */
  const reportZip = useMemo(() => extractReportZipCode(report), [report]);
  const [adminOwnershipStatus, setAdminOwnershipStatus] = useState<AdminOwnershipPanelStatus>("idle");
  const [adminOwnershipMatch, setAdminOwnershipMatch] = useState<OwnerFileReportMatch | null>(null);
  const [adminOwnershipTopClusters, setAdminOwnershipTopClusters] = useState<OwnerFileReportTopCluster[]>([]);

  useEffect(() => {
    if (!showAdminOwnership || compact || !reportZip) {
      setAdminOwnershipStatus("idle");
      return;
    }

    const controller = new AbortController();

    fetchAdminOwnershipContext({
      zip: reportZip,
      address: report.metadata?.address,
      signal: controller.signal,
      onAdminConfirmed: () => setAdminOwnershipStatus("loading"),
    })
      .then((result) => {
        setAdminOwnershipMatch(result.match);
        setAdminOwnershipTopClusters(result.topClusters);
        setAdminOwnershipStatus(result.status);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[report] admin ownership context load failed:", err);
        setAdminOwnershipStatus("error");
      });

    return () => controller.abort();
  }, [showAdminOwnership, compact, reportZip, report.metadata?.address]);

  // sm_ params (additive, spec v2 item 5): a link carrying sm_stage/
  // sm_priority opens straight into the brief, skipping the ask — the
  // Brief becomes a genuinely shareable URL, not only an in-page action.
  // Effect (not a render-time read) to stay hydration-safe, matching the
  // persona-resolution effect's own pattern.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stageParam = params.get("sm_stage");
    const priorityParam = params.get("sm_priority");
    if (isBriefStage(stageParam) && isBriefPriority(priorityParam)) {
      setBriefState({ askOpen: false, open: true, stage: stageParam, priority: priorityParam });
    }
  }, []);

  const handlePrint = () => {
    setDownloadGateOpen(true);
  };

  // R1 finding 5: this MUST stay a promise that REJECTS on failure. It is
  // awaited by DownloadGateModal, which turns a rejection into an on-screen
  // retry state; swallowing the error here would put the gate back at "done"
  // while no file was ever produced. Everything after generateReportPdf —
  // the analytics event and closing the gate — is therefore reached only on
  // a real success.
  const handleDownloadAfterCapture = async () => {
    const { generateReportPdf } = await import("@/lib/pdf-report");
    generateReportPdf(report);
    // RF2 drift fix: this event fired only on app/report/page.tsx, so every
    // download from a saved Workspace report was dark in the funnel.
    trackEvent(
      "report_pdf_downloaded",
      reportAnalyticsPayload(report, "report_pdf_download"),
    );
    setDownloadGateOpen(false);
  };

  const handleShareReport = useCallback(() => {
    if (!reportWizardState) return;
    const encoded = encodeWizardState(reportWizardState);
    // Round-trip the persona lens so a forwarded snapshot opens in the same view.
    const personaParam = personaShareParam(persona);
    const url = `${window.location.origin}/report?${encoded}${
      personaParam ? `&persona=${personaParam}` : ""
    }`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      // RF2 drift fix: mirrors app/report/page.tsx, where this event has
      // always fired — shares from a saved report were uncounted.
      trackEvent(
        "share_link_copied",
        reportAnalyticsPayload(report, "report_share_link")
      );
      setTimeout(() => setLinkCopied(false), 2500);
    });
  }, [persona, report, reportWizardState]);

  // The Brief (gate finding 8). The backlink reuses the exact same
  // share-URL construction as handleShareReport (round-trips the persona
  // lens); `src=brief` attributes a reader arriving at the full report
  // from a forwarded Brief. Matches app/report/page.tsx's briefReportUrl.
  const briefReportUrl = useMemo(() => {
    if (typeof window === "undefined" || !reportWizardState) return "";
    const encoded = encodeWizardState(reportWizardState);
    const personaParam = personaShareParam(persona);
    return `${window.location.origin}/report?${encoded}${
      personaParam ? `&persona=${personaParam}` : ""
    }&src=brief`;
  }, [persona, reportWizardState]);

  const handleBriefComplete = useCallback(
    (stage: BriefUiState["stage"], priority: BriefUiState["priority"]) => {
      setBriefState({ askOpen: false, open: true, stage, priority });
      trackEvent(
        "brief_generated",
        reportAnalyticsPayload(report, "report_brief", { stage, priority }),
      );
      if (typeof window !== "undefined" && stage && priority) {
        const url = new URL(window.location.href);
        url.searchParams.set("sm_stage", stage);
        url.searchParams.set("sm_priority", priority);
        window.history.replaceState(null, "", url.toString());
      }
    },
    [report],
  );

  const handleBriefPrint = () => {
    document.body.classList.add("printing-brief");
    window.print();
    window.setTimeout(() => document.body.classList.remove("printing-brief"), 500);
  };

  const handleSaveReport = useCallback(() => {
    trackEvent(
      "save_report_clicked",
      reportAnalyticsPayload(report, analyticsSource)
    );

    if (status === "authenticated") {
      setSaveModalOpen(true);
      return;
    }

    storePendingReport({ reportData: report, wizardState: reportWizardState });
    window.location.assign(
      `/login?callbackUrl=${encodeURIComponent("/workspace?savePending=1")}`
    );
  }, [analyticsSource, report, reportWizardState, status]);

  const handleEmailReportClick = useCallback(() => {
    trackEvent(
      "email_report_clicked",
      reportAnalyticsPayload(report, analyticsSource)
    );
    setEmailDialogOpen(true);
  }, [analyticsSource, report]);

  useEffect(() => {
    if (!supportSection || supportItems.length === 0) return;
    const supportViewKey = `${analyticsReportKey(report)}|support-view|${analyticsSource}`;
    if (viewedSupportKeyRef.current === supportViewKey) return;
    viewedSupportKeyRef.current = supportViewKey;

    trackEvent(
      "support_resource_viewed",
      reportAnalyticsPayload(report, "report_support_network", {
        organizationCount: supportItems.length,
        organizationNames: supportItems.map((item) => item.label),
        originSource: analyticsSource,
      }),
    );
  }, [analyticsSource, report, supportItems, supportSection]);

  const trackSupportResourceClick = useCallback(
    (item: ReportItem) => {
      trackEvent(
        "support_resource_clicked",
        reportAnalyticsPayload(report, "report_support_network", {
          organizationName: item.label,
          organizationType: item.value || "local_support",
          contactMethod: "website",
          originSource: analyticsSource,
        }),
      );
    },
    [analyticsSource, report],
  );

  // The support hero band's CTA (live surface only). Distinct `source` from
  // trackSupportResourceClick's so "clicked the elevated CTA" can be told
  // apart from "clicked an org inside the section".
  const trackSupportCtaClick = useCallback(
    (item: ReportItem) => {
      trackEvent(
        "support_resource_clicked",
        reportAnalyticsPayload(report, "report_support_cta", {
          organizationName: item.label,
          organizationType: item.value || "local_support",
          contactMethod: "website",
        }),
      );
    },
    [report],
  );

  const trackSectionLinkClick = useCallback(
    (section: ReportSection, item: ReportItem) => {
      if (sectionMatchesIdOrTitle(section, CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE)) {
        trackEvent(
          "capital_partner_clicked",
          reportAnalyticsPayload(report, "report_capital_partner_section", {
            partnerId: item.partnerId || item.label,
            partnerName: item.label,
            contactMethod: "website",
            originSource: analyticsSource,
          }),
        );
        return;
      }

      // RF2 drift fix: program_link_clicked fired only on the live fork, so
      // program clicks on saved reports never reached the funnel. Same
      // payload as app/report/page.tsx — `source` already names the surface.
      if (sectionMatchesIdOrTitle(section, CONFIRMED_PROGRAMS_SECTION_ID, "Programs Mapped at This Address") || item.programId) {
        trackEvent(
          "program_link_clicked",
          reportAnalyticsPayload(report, "report_program_link", {
            programId: item.programId || item.label,
            programName: item.label,
            programLevel: item.level || null,
          })
        );
      }
    },
    [analyticsSource, report],
  );

  // Refine exposure event (Tier 0 / BM6), and a click handler that records
  // banner-vs-action-row location (RF5) — mirrors app/report/page.tsx's
  // in-file ReportDisplay so refine instrumentation isn't dark on saved
  // Workspace reports too (RF1's success metric depends on this).
  const refineShownKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isInstantMode || !onRefine || compact) return;
    const shownKey = `${analyticsReportKey(report)}|refine-shown|${analyticsSource}`;
    if (refineShownKeyRef.current === shownKey) return;
    refineShownKeyRef.current = shownKey;

    trackEvent(
      "refine_cta_shown",
      reportAnalyticsPayload(report, analyticsSource, { isInstantMode })
    );
  }, [analyticsSource, compact, isInstantMode, onRefine, report]);

  const handleRefineClick = useCallback(
    (location: "banner" | "action_row") => {
      trackEvent(
        "refine_clicked",
        reportAnalyticsPayload(report, analyticsSource, { location })
      );
      onRefine?.();
    },
    [analyticsSource, onRefine, report]
  );

  const priorityBadge: Record<string, { label: string; classes: string }> = {
    high: {
      label: "High Priority",
      classes: "bg-[#0C1B33]/[0.06] text-[#0C1B33]/60 border border-[#0C1B33]/10",
    },
    medium: {
      label: "Medium",
      classes: "bg-[#0C1B33]/[0.03] text-[#0C1B33]/40 border border-[#0C1B33]/8",
    },
    low: {
      label: "Low",
      classes: "bg-[#0C1B33]/[0.02] text-[#0C1B33]/30 border border-[#0C1B33]/5",
    },
  };

  const formattedDate = new Date(report.generatedAt).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" }
  );

  const reportTypeLabels: Record<string, string> = {
    "site-incentives": "Site Incentive Analysis",
    "dev-feasibility": "Vacancy Analysis",
    "corridor-intelligence": "Corridor Intelligence",
    // Legacy
    "location-incentives": "Site Incentive Analysis",
    "best-location": "Vacancy Analysis",
    "program-explorer": "Program Explorer Report",
    "developer-analysis": "Developer Analysis Report",
  };
  const ownerOperatorSection = useMemo(
    () =>
      report.sections.find(
        (section) => sectionMatchesIdOrTitle(section, SECTION_IDS.ownerOperatorMap, "Owner & Operator Map") && section.table,
      ),
    [report.sections],
  );
  const handleOwnerOperatorExport = useCallback(() => {
    if (!ownerOperatorSection?.table) return;
    const corridorSlug = slugifyFilePart(report.metadata?.corridorLabel || report.metadata?.corridorId || "corridor");
    downloadCsv(
      buildTableCsv(ownerOperatorSection.table.columns, ownerOperatorSection.table.rows),
      `owner-operator-map-${corridorSlug}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }, [ownerOperatorSection, report.metadata?.corridorId, report.metadata?.corridorLabel]);

  if (vacancySpreadsheetLocale && !compact) {
    return (
      <VacancySpreadsheetSection
        report={report}
        reportWizardState={reportWizardState}
        compact={compact}
        analyticsSource={analyticsSource}
        formattedDate={formattedDate}
        onStartOver={onStartOver}
        onCompare={onCompare}
        compareMode={compareMode}
        compareAddressInput={compareAddressInput}
        setCompareAddressInput={setCompareAddressInput}
        compareGeocoding={compareGeocoding}
        onCompareGeocode={onCompareGeocode}
        compareGeoResult={compareGeoResult}
        handleShareReport={handleShareReport}
        handleSaveReport={handleSaveReport}
        handlePrint={handlePrint}
        handleDownloadAfterCapture={handleDownloadAfterCapture}
        handleEmailReportClick={handleEmailReportClick}
        linkCopied={linkCopied}
        downloadGateOpen={downloadGateOpen}
        setDownloadGateOpen={setDownloadGateOpen}
        emailDialogOpen={emailDialogOpen}
        setEmailDialogOpen={setEmailDialogOpen}
        saveModalOpen={saveModalOpen}
        setSaveModalOpen={setSaveModalOpen}
        vacancy={vacancy}
      />
    );
  }

  // Section numbering offset: if exec summary exists, content sections start at 02
  const hasExecSummary = !!report.executiveSummary;
  const sectionOffset = (report.summary ? 1 : 0) + (hasExecSummary ? 1 : 0);

  return (
    <motion.div {...fadeIn}>
      {/* ── Outer wrapper: off-white background ── */}
      <div className={`report-document ${compact ? "bg-transparent py-0 px-0" : "bg-[#F5F5F0] py-4 sm:py-8 px-2 sm:px-6"} print:bg-white print:p-0`}>
        {/* ── Document ── */}
        <div className={`mx-auto ${compact ? "max-w-none" : "max-w-[850px]"} bg-white shadow-xl print:shadow-none`}>
          {/* ── Cover / Header Bar ── */}
          {boardPersona ? (
            <PersonaReportHeader
              report={report}
              persona={boardPersona}
              onSwitchToAll={() => handlePersonaSelect(DEFAULT_PERSONA)}
              compact={compact}
            />
          ) : (
          <div className={`report-cover bg-[#0C1B33] ${compact ? "px-4 pt-6 pb-5" : "px-5 sm:px-12 md:px-16 pt-12 pb-10"}`}>
            {isInstantMode && (
              <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/50 mb-2">
                Location Snapshot
              </p>
            )}
            <p className="font-mono-bureau text-[9px] tracking-[0.35em] uppercase text-white/40 mb-5">
              Chicago Site Incentive Map
            </p>
            <h1 className={`font-editorial ${compact ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl lg:text-[42px]"} text-white leading-tight mb-3`}>
              {isInstantMode && report.metadata?.address
                ? `Location Snapshot — ${report.metadata.address}`
                : report.title}
            </h1>
            {report.subtitle && (
              <p className="text-white/50 text-[15px] leading-relaxed max-w-xl mb-6">
                {report.subtitle}
              </p>
            )}
            <div className="w-10 h-[3px] bg-white/30" />
          </div>
          )}

          <DrawnAreaScopeUnavailableBanner scope={vacancySpreadsheetScope} />

          {/* Refine value preview (audit RF6/WU5/BM1): explain what
              refining unlocks — goal-based organization, action plan, and gap checklist —
              with an inline goal-first quick refine where the caller supplies
              one. Rendered in compact (compare) mode too — audit RF4. The
              full-refine path routes through handleRefineClick so PR #49's
              refine_clicked keeps firing (location: banner) alongside the
              panel's own refine_value_preview_shown exposure event. */}
          {isInstantMode && !showPersonaView && (
            <RefineValuePanel
              report={report}
              context={refineContext}
              onRefine={onRefine ? () => handleRefineClick("banner") : undefined}
              onQuickRefine={onQuickRefine}
              quickRefineBusy={quickRefineBusy}
              compact={compact}
            />
          )}

          {/* ── Persona lens chips (Tier 1b, BM4). Gated on showPersonaLens,
              NOT isInstantMode (snapshot-only), so saved goal-refined reports
              keep the lens too. ── */}
          {showPersonaLens && !showPersonaView && !compact && (
            <PersonaChips
              persona={persona}
              onSelect={handlePersonaSelect}
              report={report}
            />
          )}

          {/* Shared-link recipient experience (spec v2 deliverable 7): a
              framed link opened in the sender's chosen lens — say so, and
              offer the one-tap escape to the unfiltered view. */}
          {showPersonaLens && !showPersonaView && !compact && isFramedPersonaLink && persona !== DEFAULT_PERSONA && (
            <div
              data-testid="framed-persona-notice"
              className="px-5 sm:px-12 md:px-16 py-2.5 border-b border-[#0C1B33]/8 bg-[#EFF3FB] text-[11px] text-[#0C1B33]/70 flex items-center gap-2 print:hidden"
            >
              <span>
                Viewing as <strong className="font-semibold">{personaLabel(persona)}</strong> — the
                lens this link was shared with.
              </span>
              <button
                type="button"
                onClick={() => handlePersonaSelect(DEFAULT_PERSONA)}
                className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#2563EB] hover:underline cursor-pointer"
              >
                Switch to All for everything
              </button>
            </div>
          )}

          {/* ── Metadata Row ── */}
          {!showPersonaView && (
          <div className={`report-meta ${compact ? "px-4 py-3" : "px-5 sm:px-12 md:px-16 py-5"} border-b border-[#0C1B33]/8 flex flex-wrap gap-x-5 sm:gap-x-8 gap-y-3`}>
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                Date
              </span>
              <span className="text-[#0C1B33] text-[13px]">
                {formattedDate}
              </span>
            </div>
            <div>
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                Report Type
              </span>
              <span className="text-[#0C1B33] text-[13px]">
                {reportTypeLabels[report.reportType] || report.reportType}
              </span>
            </div>
            {report.metadata?.address && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Address
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.address}
                </span>
              </div>
            )}
            {report.metadata?.industry && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Industry
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.industry}
                </span>
              </div>
            )}
            {selectedProjectGoalLabels({
              projectGoals: report.metadata?.projectGoals,
              projectType: report.metadata?.projectType,
              customGoal: report.metadata?.customGoal,
            }).length > 0 && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Project Goals
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {selectedProjectGoalLabels({
                    projectGoals: report.metadata?.projectGoals,
                    projectType: report.metadata?.projectType,
                    customGoal: report.metadata?.customGoal,
                  }).join(", ")}
                </span>
              </div>
            )}
            {report.metadata?.corridorLabel && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Geography
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.corridorLabel}
                </span>
              </div>
            )}
            {report.metadata?.zoneClass && (
              <div>
                <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/30 block mb-0.5">
                  Zoning
                </span>
                <span className="text-[#0C1B33] text-[13px]">
                  {report.metadata.zoneClass}
                  {report.metadata.zoneType && (
                    <span className="text-[#0C1B33]/40"> ({report.metadata.zoneType})</span>
                  )}
                </span>
              </div>
            )}
          </div>
          )}

          {showAdminOwnership && !showPersonaView && !compact && (
            <AdminOwnershipPanel
              status={adminOwnershipStatus}
              zip={reportZip}
              match={adminOwnershipMatch}
              topClusters={adminOwnershipTopClusters}
            />
          )}

          {!showPersonaView && (
            <CapitalPartnerHandoff
              report={report}
              source={analyticsSource}
              compact={compact}
            />
          )}

          {/* ── Support network, elevated (LIVE surface only — section 3.3).
                A saved report leaves the support organizations in their
                section, where they have always been. ── */}
          {elevateSupportNetwork && !showPersonaView && supportItems.length > 0 && !compact && (
            <div className="px-5 sm:px-12 md:px-16 py-5 border-b border-[#0C1B33]/8 bg-[#FAF9F6]">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="font-mono-bureau text-[9px] tracking-[0.25em] uppercase text-[#2563EB]/60 mb-1.5">
                    Local support organizations
                  </div>
                  <h2 className="font-editorial text-[22px] text-[#0C1B33] leading-snug">
                    {SUPPORT_ORGANIZATIONS_SECTION_TITLE}
                  </h2>
                  <p className="text-[#0C1B33]/45 text-[13px] leading-relaxed mt-1.5 max-w-2xl">
                    {SUPPORT_ORGANIZATIONS_DESCRIPTION}
                  </p>
                  <p className="text-[#0C1B33]/35 text-[11px] leading-relaxed mt-1.5 max-w-2xl">
                    {SUPPORT_ORGANIZATIONS_CAPACITY_NOTE}
                  </p>
                  <p className="font-mono-bureau text-[9px] tracking-[0.08em] text-[#0C1B33]/30 mt-2 truncate">
                    {supportItems.length} selected · {supportItems.slice(0, 3).map((item) => item.label).join(" · ")}
                    {supportItems.length > 3 ? " · more below" : ""}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 md:justify-end">
                  {supportCtaItem && supportCtaUrl && (
                    <a
                      href={supportCtaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackSupportCtaClick(supportCtaItem)}
                      className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[9px] tracking-[0.14em] uppercase px-4 py-3 hover:bg-[#0C1B33]/80 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Visit {supportCtaItem.label}
                    </a>
                  )}
                  <a
                    href="#your-support-network"
                    className="inline-flex items-center justify-center gap-2 border border-[#0C1B33]/12 bg-white text-[#0C1B33]/55 font-mono-bureau text-[9px] tracking-[0.14em] uppercase px-4 py-3 hover:border-[#0C1B33]/25 hover:text-[#0C1B33] transition-colors"
                  >
                    See all organizations
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ── Table of Contents ── */}
          {!showPersonaView && tocEntries.length > 0 && (
            <nav className="px-5 sm:px-12 md:px-16 pt-8 pb-2">
              <span className="font-mono-bureau text-[8px] tracking-[0.25em] uppercase text-[#0C1B33]/25 block mb-3">
                Contents
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                {tocEntries.map((entry, i) => (
                  <a
                    key={entry.anchor}
                    href={`#${entry.anchor}`}
                    className="flex items-baseline gap-2 group py-0.5"
                  >
                    <span className="font-mono-bureau text-[9px] text-[#0C1B33]/15 w-5 text-right flex-shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-mono-bureau text-[10px] tracking-[0.05em] text-[#0C1B33]/45 group-hover:text-[#0C1B33] transition-colors">
                      {entry.label}
                    </span>
                  </a>
                ))}
              </div>
            </nav>
          )}

          {/* ── Zoning Map ── */}
          {!showPersonaView && report.metadata?.lat != null && report.metadata?.lon != null && (
            <div className="px-5 sm:px-12 md:px-16 pt-8">
              <ReportZoningMap
                lat={report.metadata.lat}
                lon={report.metadata.lon}
                address={report.metadata?.address}
              />
            </div>
          )}

          {/* ── Report Body ── */}
          <div className={`report-body ${compact ? "px-4 py-8" : "px-5 sm:px-12 md:px-16 py-14"}`}>
            {showPersonaView && boardPersona && (
              <>
                {boardPersona === "looking" && renderGuidepostBand(1)}
                <PersonaExecutiveSummary
                  report={boardPersona === "looking" ? report : lensed}
                  programsAnchor={personaProgramsAnchor}
                  sectionNumber={boardPersona === "looking" ? "01" : undefined}
                />
              </>
            )}
            {/* ── Start Here (Phase B of the startHere consolidation): the
                canonical one-action card, first content block in the body.
                Absent on reports without report.startHere (older saved
                reports, or report types outside the executive-summary
                gate) — the rest of the body renders unchanged either way. ── */}
            {!showPersonaView && <StartHereCard report={report} source={analyticsSource} />}

            {/* ── Overview text ── */}
            {!showPersonaView && report.summary && (
              <div className="mb-12">
                <p className="text-[#0C1B33]/60 text-[15px] leading-[1.8] max-w-prose">
                  {report.summary}
                </p>
              </div>
            )}

            <VacancySpreadsheetSummaryCard
              compact={compact}
              showPersonaView={showPersonaView}
              vacancy={vacancy}
            />

            {/* ── Verdict Card ── */}
            {!showPersonaView && report.verdict && (
              <div id="verdict">
                <VerdictCard verdict={report.verdict} />
              </div>
            )}

            {/* ── Who can help — support network elevated to the top
                  (LIVE surface only, section 3.4). ── */}
            {elevateSupportNetwork && !showPersonaView && supportSection && supportItems.length > 0 && (
              <VerdictPartnerStrip
                items={supportItems}
                onPartnerClick={(item) =>
                  trackSectionLinkClick(supportSection, item)
                }
              />
            )}

            {/* ── Executive Summary from Confidence Engine ── */}
            {!showPersonaView && report.executiveSummary && (
              <div id="executive-summary">
                <ExecutiveSummarySection
                  summary={report.executiveSummary}
                  isEditing={isEditingSummary}
                  editedText={editedSummaryText}
                  onToggleEdit={() => setIsEditingSummary(!isEditingSummary)}
                  onTextChange={setEditedSummaryText}
                  collapseTopActions={Boolean(report.startHere)}
                />
              </div>
            )}

            {/* Action-first hierarchy: orient the user before detailed evidence. */}
            {!showPersonaView && lensed.actionRoadmap && lensed.actionRoadmap.length > 0 && (
              <div id="action-roadmap">
                <ActionRoadmapSection
                  items={lensed.actionRoadmap}
                  onContactClick={(item, contactMethod) =>
                    trackEvent(
                      "support_resource_clicked",
                      reportAnalyticsPayload(report, "action_roadmap", {
                        organizationName: item.contact?.agency || item.programName || item.label,
                        organizationType: item.contact?.role || "program_contact",
                        contactMethod,
                        programId: item.programId || null,
                        programName: item.programName || null,
                      })
                    )
                  }
                />
              </div>
            )}

            {/* ── Content Sections ── */}
            {(() => {
              const personaAlsoSection = lensed.sections?.find(
                (section) => section.collapsedByPersona,
              );
              return lensed.sections?.flatMap((section, sectionIdx) => {
                // Part-03 correction (late owner amendment, binding): on a
                // real persona lens, Part 03 contains EXACTLY ONE section —
                // the Contact Sheet. Suppress the raw support-organizations
                // section here; its orgs still reach the reader, lane-ranked
                // and why-lined, as ContactSheet rows below. "All" is
                // untouched.
                if (
                  isSupportOrganizationSectionTitle(section.title) &&
                  showPersonaView
                ) {
                  return [];
                }
                if (showPersonaView && section.collapsedByPersona) return [];

                const sectionNumber = showPersonaView
                  ? String(++personaSectionCounter).padStart(2, "0")
                  : String(sectionIdx + sectionOffset + 1).padStart(2, "0");
                const sectionKey = sectionStateKey(section);
                const guidepostPart = showPersonaView
                  ? guidepostPartForSection(section, persona)
                  : null;
                const band =
                  guidepostPart !== null && guidepostPart !== guidepostBandTracker
                    ? renderGuidepostBand(guidepostPart)
                    : null;
                guidepostBandTracker = guidepostPart;

                // Progressive disclosure (section 3.1), live surface only.
                // On a persona board every section is pinned open; on a saved
                // report nothing collapses at all, so the head renders without
                // an expand affordance and this is always true.
                //
                // The `collapsedByPersona` arm below is the live fork's
                // shipped expression and is kept verbatim, but it is
                // unreachable: applyPersonaLens only sets that flag for a REAL
                // persona, and a real persona means showPersonaView. See
                // docs/report-renderer-unification.md section 6, finding 2.
                const sectionOpen = !progressiveDisclosure
                  ? true
                  : showPersonaView
                  ? true
                  : section.collapsedByPersona
                  ? (expandedSections[sectionKey] ?? false)
                  : isSectionOpen(sectionKey, sectionIdx, section.title);
                const isPersonaProgramSection =
                  showPersonaView && section.guidepostBucket === "programs";
                // Owner ruling 2026-08-31 (routing-first supporter cards):
                // the supporter lens renders its program cards in the compact
                // routing variant, full blessed panel one disclosure deep.
                const isRoutingProgramSection =
                  isPersonaProgramSection && boardPersona === "supporter";
                const isPersonaFactSection =
                  showPersonaView &&
                  ["siteFacts", "logisticsAccess", "civicRepresentation", "zoning"].includes(
                    section.guidepostBucket ?? "",
                  );
                // Number + title. Shared by both head variants below so the
                // one thing that genuinely differs between the surfaces —
                // whether the head is an interactive control — is the only
                // thing that is written twice.
                const sectionHeading = (
                  <>
                    <span className={showPersonaView ? "font-mono-bureau text-[10px] text-[#2563EB]" : "font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8"}>
                      {sectionNumber}
                    </span>
                    <h2 className={showPersonaView ? "font-editorial text-[15.5px] font-semibold normal-case tracking-normal text-[#0C1B33]" : "font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]"}>
                      {section.title}
                    </h2>
                  </>
                );

                const sectionElement = (
                  <div
                    key={sectionKey}
                    id={sectionToAnchor(section)}
                    data-persona-section-open={showPersonaView ? sectionOpen : undefined}
                    className={`report-section ${
                      showPersonaView
                        ? "mb-0 border-b border-[#D8DDE6] py-4"
                        : sectionOpen
                          ? "mb-14"
                          : "report-section-collapsed mb-6"
                    }`}
                  >
                    {progressiveDisclosure ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (showPersonaView) return;
                          setExpandedSections((prev) => ({
                            ...prev,
                            [sectionKey]: !sectionOpen,
                          }));
                          trackEvent("section_expanded", {
                            reportType: report.reportType,
                            source: "report_section_toggle",
                            metadata: {
                              sectionId: sectionToAnchor(section),
                              sectionTitle: section.title,
                              sectionIndex: sectionIdx,
                              state: sectionOpen ? "collapsed" : "expanded",
                            },
                          });
                        }}
                        aria-expanded={sectionOpen}
                        className={`section-head group mb-4 flex w-full items-baseline text-left ${showPersonaView ? "gap-2.5 cursor-default" : "gap-4 cursor-pointer print:cursor-auto"}`}
                      >
                        {sectionHeading}
                        {!showPersonaView && <span className="ml-auto font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/30 group-hover:text-[#2563EB] transition-colors print:hidden">
                          {sectionOpen
                            ? "Collapse"
                            : `Expand${section.items?.length ? ` · ${section.items.length}` : ""}`}
                        </span>}
                      </button>
                    ) : (
                      <>
                        <div className={`flex items-baseline mb-4 ${showPersonaView ? "gap-2.5" : "gap-4"}`}>
                          {sectionHeading}
                        </div>
                        {!showPersonaView && <hr className="border-[#0C1B33]/8 mb-5" />}
                      </>
                    )}
	                    {!showPersonaView && section.description && (
	                      <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed mb-6 max-w-prose">
	                        {section.description}
	                      </p>
	                    )}
                    {showPersonaView &&
                      isPersonaProgramSection &&
                      visibleSectionItems(section).length === 0 &&
                      section.description && (
                        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-[#5A6478]">
                          {section.description}
                        </p>
                      )}

                    {sectionMatchesIdOrTitle(section, SECTION_IDS.ownerOperatorMap, "Owner & Operator Map") && section.table && (
                      <div className="mb-5">
                        <button
                          type="button"
                          onClick={handleOwnerOperatorExport}
                          className="inline-flex items-center justify-center gap-2 bg-[#0C1B33] text-white font-mono-bureau text-[9px] tracking-[0.15em] uppercase px-4 py-2.5 hover:bg-[#0C1B33]/80 transition-colors cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Download Owner / Operator CSV
                        </button>
                      </div>
                    )}

	                    {section.table && section.table.rows.length > 0 && (
	                      <div className="border border-[#0C1B33]/8 overflow-x-auto mb-8">
	                        <table className="w-full min-w-[680px] text-left text-[12px]">
	                          <thead className="bg-[#0C1B33]/[0.03]">
	                            <tr>
	                              {section.table.columns.map((column) => (
	                                <th
	                                  key={column}
	                                  className="px-4 py-3 font-mono-bureau text-[8px] tracking-[0.16em] uppercase text-[#0C1B33]/35"
	                                >
	                                  {column}
	                                </th>
	                              ))}
	                            </tr>
	                          </thead>
	                          <tbody className="divide-y divide-[#0C1B33]/5">
	                            {section.table.rows.map((row, rowIndex) => (
	                              <tr key={rowIndex}>
	                                {row.map((cell, cellIndex) => (
	                                  <td
	                                    key={`${rowIndex}-${cellIndex}`}
	                                    className={`px-4 py-3 align-top ${
	                                      cellIndex === 0
	                                        ? "font-medium text-[#0C1B33]/75"
	                                        : "text-[#0C1B33]/45"
	                                    }`}
	                                  >
	                                    {cell}
	                                  </td>
	                                ))}
	                              </tr>
	                            ))}
	                          </tbody>
	                        </table>
	                      </div>
	                    )}

	                    {/* Neighborhood Economic Context comparison bars */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.neighborhoodEconomicContext, "Neighborhood Economic Context") && report.marketContext?.comparisons && (
                      <div className="space-y-0 divide-y divide-[#0C1B33]/5 mb-6">
                        {report.marketContext.comparisons.income && (
                          <ComparisonBar
                            label="Median Household Income"
                            locationFormatted={`$${report.marketContext.comparisons.income.location.toLocaleString()}`}
                            cityFormatted={`$${report.marketContext.comparisons.income.city.toLocaleString()}`}
                            pct={report.marketContext.comparisons.income.pct}
                          />
                        )}
                        {report.marketContext.comparisons.homeValue && (
                          <ComparisonBar
                            label="Median Home Value"
                            locationFormatted={`$${report.marketContext.comparisons.homeValue.location.toLocaleString()}`}
                            cityFormatted={`$${report.marketContext.comparisons.homeValue.city.toLocaleString()}`}
                            pct={report.marketContext.comparisons.homeValue.pct}
                          />
                        )}
                        {report.marketContext.comparisons.population && (
                          <ComparisonBar
                            label="Tract Population"
                            locationFormatted={report.marketContext.comparisons.population.location.toLocaleString()}
                            cityFormatted={`${report.marketContext.comparisons.population.city.toLocaleString()} avg`}
                            pct={report.marketContext.comparisons.population.pct}
                          />
                        )}
                        {report.marketContext.comparisons.walkScore && (
                          <ComparisonBar
                            label="EPA Walkability Index"
                            locationFormatted={`${report.marketContext.comparisons.walkScore.location}/20`}
                            cityFormatted={`${report.marketContext.comparisons.walkScore.city}/20`}
                            pct={report.marketContext.comparisons.walkScore.pct}
                          />
                        )}
                      </div>
                    )}

                    {/* Neighborhood economic signal cards */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.neighborhoodEconomicContext, "Neighborhood Economic Context") && report.neighborhoodEconomics && (
                      <EconomicSignalCards economics={report.neighborhoodEconomics} />
                    )}

                    {showPersonaView &&
                      boardPersona &&
                      section.guidepostBucket === "neighborhoodContext" && (
                        <PersonaNeighborhoodSupplement
                          report={report}
                          persona={boardPersona}
                        />
                      )}

                    {/* Local Impact Anchors — dedicated section, card layout */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.localImpactAnchors, "Local Impact Anchors") && report.neighborhoodEconomics?.anchors && (
                      <AnchorCards anchors={report.neighborhoodEconomics.anchors} />
                    )}

                    {/* Factual zone coverage and program interactions */}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.incentiveZoneCoverage, "Incentive Zone Coverage & Program Interactions") && report.stackingAnalysis && (
                      <div className="mb-8">
                        <div className="mb-6 border-l-2 border-[#2563EB]/25 pl-4">
                          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.15em] text-[#0C1B33]/35">
                            Mapped zone coverage
                          </span>
                          <p className="mt-1 text-[13px] text-[#0C1B33]/60">
                            {report.stackingAnalysis.zoneCount} incentive zone{report.stackingAnalysis.zoneCount === 1 ? "" : "s"} intersect this address.
                          </p>
                        </div>

                        {/* Program interaction table */}
                        {(report.stackingAnalysis.combinations.length > 0 || report.stackingAnalysis.rules.length > 0) && (
                          <div className="border border-[#0C1B33]/8 overflow-hidden">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="bg-[#0C1B33]/[0.03]">
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5">Programs</th>
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5 w-24">Next step</th>
                                  <th className="text-left font-mono-bureau text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/40 px-4 py-2.5 hidden sm:table-cell">What to confirm</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#0C1B33]/5">
                                {report.stackingAnalysis.combinations.map((combo, ci) => (
                                  <tr key={`combo-${ci}`}>
                                    <td className="px-4 py-3 text-[#0C1B33]/70 font-medium">{combo.zones.join(" + ")}</td>
                                    <td className="px-4 py-3">
                                      <span className="font-mono-bureau text-[9px] tracking-[0.1em] uppercase text-[#0C1B33]/50 bg-[#0C1B33]/[0.04] px-2 py-0.5">
                                        Verify
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#0C1B33]/40 hidden sm:table-cell">{combo.benefit}</td>
                                  </tr>
                                ))}
                                {report.stackingAnalysis.rules.map((rule, ri) => (
                                  <tr key={`rule-${ri}`}>
                                    <td className="px-4 py-3 text-[#0C1B33]/70 font-medium">{rule.programA} + {rule.programB}</td>
                                    <td className="px-4 py-3">
                                      <span className="bg-[#0C1B33]/[0.04] px-2 py-0.5 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/50">
                                        Verify
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-[#0C1B33]/40 hidden sm:table-cell">{rule.reason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {isRoutingProgramSection && visibleSectionItems(section).length > 0 && (
                      <ProgramRoutingViewNote />
                    )}
                    {visibleSectionItems(section).length > 0 && (
                      <div className={isPersonaFactSection ? "grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3" : "space-y-0 divide-y divide-[#0C1B33]/5"}>
                        {visibleSectionItems(section).map((item, itemIdx) => {
                          const reportItem = item as ReportNavigationItem;
                          const isSupportNetworkItem = isSupportOrganizationSectionTitle(section.title);
                          const isDeadlineItem = sectionMatchesIdOrTitle(section, SECTION_IDS.upcomingDeadlines, "Upcoming Deadlines Near This Address");
                          const supportWebsiteUrl = isSupportNetworkItem ? (reportItem.sourceUrl || reportItem.url) : undefined;
                          const hasGroupedDetail = Boolean(item.detailGroups?.length);
                          const hasSideValue = Boolean(item.value && !hasGroupedDetail);
                          // Gate round 3 BLOCKER 11 RULING: real program items'
                          // `item.detail` (== program.summary) now renders as
                          // ProgramCardFace's "What it funds" block instead of
                          // here, matching the board's sequence — suppressed
                          // below so it never renders in both places on one
                          // card. `programId` is set on every ReportItem
                          // programReportItem() builds, regardless of section.
                          const isProgramCardItem = Boolean(item.programId);
                          const isPersonaProgramSibling =
                            isPersonaProgramSection && itemIdx > 0;
                          // review7 S20 (MEDIUM): the itemProgram/programById
                          // fallback removed — see ReportNavigationLinks.tsx's
                          // own comment; programReportItem() already sets
                          // these fields directly on every program-linked
                          // ReportItem, so the fallback was already dead
                          // (confirmed during review6 S11's investigation).
                          const hasNavigationLinks = Boolean(
                            reportItem.sourceUrl ||
                            reportItem.applicationPortals?.length ||
                            reportItem.verificationSteps?.length,
                          );

                          return (
                            <div
                              key={itemIdx}
                              className={`report-item ${isPersonaFactSection ? "py-1" : "py-5 first:pt-0 sm:py-6"} ${
                                isPersonaProgramSection && itemIdx === 0
                                  ? "my-3 border-2 border-[#2563EB] bg-white px-4 sm:px-5"
                                  : ""
                              }`}
                            >
                            <div className={`grid grid-cols-1 ${isPersonaFactSection ? "gap-1" : "gap-3"} ${hasSideValue && !isPersonaFactSection ? "sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-x-10" : ""}`}>
                              {/* Left: label */}
                              <div className="flex-1 min-w-0">
                                <span className={isPersonaFactSection ? "flex flex-wrap items-center gap-2 font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#5A6478]" : "flex flex-wrap items-center gap-2 text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold"}>
                                  {supportWebsiteUrl ? (
                                    <a
                                      href={supportWebsiteUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={() => trackSupportResourceClick(reportItem)}
                                      className="inline-flex items-center gap-1.5 hover:text-[#2F5BEA] transition-colors print-url"
                                    >
                                      {item.label}
                                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                    </a>
                                  ) : (
                                    item.label
                                  )}
                                  {item.level && (
                                    <span className="font-mono-bureau text-[8px] sm:text-[9px] tracking-[0.15em] uppercase text-[#0C1B33]/25 ml-2 font-normal">
                                      {item.level}
                                    </span>
                                  )}
                                  {item.preparationCost && <PreparationCostBadge signal={item.preparationCost} />}
                                </span>
                                {!isPersonaFactSection && !isProgramCardItem && !hasGroupedDetail && item.detail && sectionMatchesIdOrTitle(section, SECTION_IDS.requiredDocuments, "Required Documents") ? (
                                  <ul className="mt-2 space-y-1.5">
                                    {item.detail.split("\n").map((line, li) => {
                                      const { documentName, programs, cost } = parseDocumentCostLine(line);
                                      return (
                                        <li key={li} className="flex items-start gap-2 text-[11px] sm:text-[12px] leading-relaxed">
                                          <span className="text-[#0C1B33]/15 mt-0.5 flex-shrink-0">&bull;</span>
                                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[#0C1B33]/55">
                                            <span>{documentName}</span>
                                            {cost && <PreparationCostBadge signal={cost} label="Prep" />}
                                            {programs && (
                                              <span className="text-[#0C1B33]/25 ml-1.5">— {programs}</span>
                                            )}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                ) : !isPersonaFactSection && !isProgramCardItem && !hasGroupedDetail && item.detail ? (
                                  <span className={`mt-1.5 block text-[12px] leading-[1.65] text-[#0C1B33]/50 sm:text-[13px] ${isSupportNetworkItem || isDeadlineItem || sectionMatchesIdOrTitle(section, CAPITAL_PARTNER_SECTION_ID, CAPITAL_PARTNER_SECTION_TITLE) ? "whitespace-pre-line" : ""}`}>
                                    {item.detail}
                                  </span>
                                ) : null}
                              </div>

                              {/* Right: value */}
                              {hasSideValue && (
                                <span className={isPersonaFactSection ? "min-w-0 break-words text-[12.5px] leading-[1.45] text-[#0C1B33]" : "min-w-0 break-words font-mono-bureau text-[11px] leading-[1.7] text-[#0C1B33]/50 sm:text-[12px]"}>
                                  {item.value}
                                </span>
                              )}
                            </div>

                            {!isPersonaFactSection && hasGroupedDetail && item.detailGroups && (
                              <GroupedReportDetail
                                summary={item.value}
                                groups={item.detailGroups}
                                caveat={item.detailCaveat}
                              />
                            )}

                            {/* Gate finding 11 + gate round 2 BLOCKER 11 + gate round 3
                                BLOCKER 11 RULING: ALL "blessed" card content lives on
                                the FACE, in the BOARD's exact sequence (the board wins
                                over spec v2 prose per the round-3 ruling) — header
                                (administrator/status/window pills), glance row, cost
                                signals, "What it funds," Commonly required (all
                                ProgramCardFace), then reason chips labeled "Why this
                                is shown" (ReasonChips), then Can combine with,
                                next-step+contact, What to expect, Verify at the source
                                + the traces-to-public-record line (all
                                ProgramCardExtras — moved OUT of the accordion below
                                entirely). Same source data throughout — only
                                where/how it renders changed. See ProgramCardFace.tsx's
                                and ProgramCardExtras.tsx's own header comments for the
                                full board-order rationale, and
                                lib/__tests__/refine-tier1.test.ts's real render-order
                                test for the enforcing proof. */}
                            {/* Owner ruling 2026-08-31: on the SUPPORTER lens a
                                program card renders the routing variant instead
                                — glance row + why-shown chips + next step, with
                                this exact blessed panel (face, chips, extras)
                                one disclosure away inside the card. Every other
                                lens is untouched. */}
                            {isRoutingProgramSection && item.programId && (
                              <ProgramRoutingCard item={item} />
                            )}
                            {!isSupportNetworkItem && !isPersonaProgramSibling && !(isRoutingProgramSection && item.programId) && (
                              <>
                                <ProgramCardFace item={item} />
                                <ReasonChips explanation={item.matchExplanation} />
                                <ProgramCardExtras item={item} />
                              </>
                            )}
                            {isPersonaProgramSibling && !(isRoutingProgramSection && item.programId) && (
                              <ReasonChips explanation={item.matchExplanation} />
                            )}

                            {/* Genuinely supplementary detail only — the deeper
                                match-explanation facts (public data, your answers,
                                still to confirm, documents to gather, confirm-with)
                                and official navigation. */}
                            {!showPersonaView && !isSupportNetworkItem && (item.matchExplanation || item.url || hasNavigationLinks) && (
                              <Accordion type="single" collapsible className="mt-3 sm:mt-4">
                                <AccordionItem value="program-review" className="border-none">
                                  <AccordionTrigger className="py-2 hover:no-underline font-mono-bureau text-[9px] tracking-[0.1em] text-[#0C1B33]/40 uppercase">
                                    Program review details
                                  </AccordionTrigger>
                                  <AccordionContent className="report-eligibility pl-4 border-l border-[#0C1B33]/8 space-y-2">
                                    <MatchExplanationDetails explanation={item.matchExplanation} />
                                    {item.url && (
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => trackSectionLinkClick(section, item)}
                                        className="inline-flex items-center gap-1.5 text-[11px] text-[#0C1B33]/50 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide print-url"
                                      >
                                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                        More information
                                      </a>
                                    )}
                                    <ReportNavigationLinks item={reportItem} />
                                    {item.lastVerifiedAt && (
                                      <FreshnessBadge lastVerifiedAt={item.lastVerifiedAt} isStale={item.isStale} />
                                    )}
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                    {isPersonaProgramSection && personaAlsoSection && (
                      <PersonaAlsoAtAddress items={personaAlsoSection.items} />
                    )}
                    {sectionMatchesIdOrTitle(section, SECTION_IDS.zoningUseStartingPoint, "Zoning & Use Starting Point") && report.metadata?.zoneClass && (
                      <>
                        {/* Owner ruling A2: every view — the kitchen sink AND
                            every persona lens — gets the district family +
                            authority line next to the published code. zoneClass
                            never renders without this detail. */}
                        <ZoningStarterHandoff
                          zoneClass={report.metadata.zoneClass}
                          siteSpecificOrdinanceUrl={section.items.find((item) => item.label === "City Zoning Classification")?.url}
                        />
                        {/* Owner ruling A3 (amended): the activity questionnaire
                            — and its one-pager handoff button — is excluded
                            from every persona lens, present only on "all". */}
                        {(!showPersonaLens || persona === DEFAULT_PERSONA) && (
                          <div className="mt-8 print:hidden">
                            <ZoningReviewQuestions
                              zoneClass={report.metadata.zoneClass}
                              siteSpecificOrdinanceUrl={section.items.find((item) => item.label === "City Zoning Classification")?.url}
                              address={report.metadata.address}
                              businessType={report.metadata.industry ?? report.metadata.proposedUse}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
                // Owner ruling 2026-08-31 (who-to-call pointer): PART 02 ends
                // by pointing the supporter at the Contact Sheet in PART 03.
                // Rendered AFTER the programs section, inside the same part —
                // no new data, no reordering of the guidepost anatomy.
                const whoToCall =
                  isRoutingProgramSection && boardPersona ? (
                    <ContactSheetPointerRow
                      key={`${sectionKey}-who-to-call`}
                      report={lensed}
                      persona={boardPersona}
                    />
                  ) : null;
                const supplements =
                  isPersonaProgramSection && boardPersona
                    ? (
                        <PersonaProgramSupplements
                          key={`${sectionKey}-supplements`}
                          report={report}
                          lensedReport={lensed}
                          persona={boardPersona}
                          firstSectionNumber={personaSectionCounter + 1}
                        />
                      )
                    : null;
                if (isPersonaProgramSection && boardPersona) {
                  personaSectionCounter += personaProgramSupplementCount(
                    report,
                    lensed,
                    boardPersona,
                  );
                }
                return [band, sectionElement, whoToCall, supplements].filter(Boolean);
              });
            })()}

            {boardPersona === "looking" && (
              <>
                {renderGuidepostBand(2)}
                <WhatsNotablePanel report={report} sectionNumber="03" />
                {renderGuidepostBand(3)}
                <ExploreByInterestPanel
                  report={report}
                  onSelectPersona={handlePersonaSelect}
                  sectionNumber="04"
                  fullPictureSectionNumber="05"
                />
              </>
            )}

            {boardPersona && boardPersona !== "looking" && (
              <>
                {renderGuidepostBand(3)}
                <ContactSheet
                  report={lensed}
                  persona={boardPersona}
                  sectionNumber={personaContactSectionNumber(personaSectionCounter)}
                />
              </>
            )}

            {/* ── Recommended Actions ──
                Demoted behind native disclosure when report.startHere is
                present — StartHereCard already surfaced the one dominant
                action at the top of the body, so this list (still every
                action, unchanged content) collapses instead of competing
                with it. Absent report.startHere, this renders exactly as
                before. */}
            {!showPersonaView && report.recommendedActions &&
              report.recommendedActions.length > 0 && (() => {
                const sectionNumber = String(
                  (report.sections?.length || 0) + sectionOffset + 1
                ).padStart(2, "0");
                const actionsList = (
                  <div className="space-y-5">
                    {report.recommendedActions.map((action, actionIdx) => {
                      const priority = action.priority || "medium";
                      const badge =
                        priorityBadge[priority] || priorityBadge.medium;

                      return (
                        <div key={actionIdx} className="flex items-start gap-4">
                          {/* Number */}
                          <span className="font-editorial text-[18px] sm:text-[22px] leading-none text-[#0C1B33]/15 flex-shrink-0 w-6 sm:w-7 text-right pt-0.5">
                            {actionIdx + 1}.
                          </span>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start sm:items-center gap-2 sm:gap-3 mb-1 flex-wrap">
                              <span className="text-[#0C1B33] text-[13px] sm:text-[14px] font-semibold">
                                {action.label}
                              </span>
                              <span
                                className={`font-mono-bureau text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 rounded-sm ${badge.classes}`}
                              >
                                {badge.label}
                              </span>
                              {action.preparationCost && <PreparationCostBadge signal={action.preparationCost} />}
                            </div>
                            {action.description && (
                              <p className="text-[#0C1B33]/45 text-[13px] leading-relaxed">
                                {action.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );

                return report.startHere ? (
                  <details id="recommended-actions" className="mb-12 group">
                    <summary className="flex items-baseline gap-4 mb-4 cursor-pointer select-none list-none">
                      <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                        {sectionNumber}
                      </span>
                      <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                        Recommended Actions · {report.recommendedActions.length}
                      </h2>
                    </summary>
                    <hr className="border-[#0C1B33]/8 mb-5" />
                    {actionsList}
                  </details>
                ) : (
                  <div id="recommended-actions" className="mb-12">
                    <div className="flex items-baseline gap-4 mb-4">
                      <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                        {sectionNumber}
                      </span>
                      <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                        Recommended Actions
                      </h2>
                    </div>
                    <hr className="border-[#0C1B33]/8 mb-5" />
                    {actionsList}
                  </div>
                );
              })()}

            {/* ── Data Sources ── */}
            {!showPersonaView && report.dataSources && report.dataSources.length > 0 && (
              <div id="data-sources" className="mb-12">
                <div className="flex items-baseline gap-4 mb-4">
                  <span className="font-editorial text-[28px] sm:text-[40px] leading-none text-[#0C1B33]/8">
                    {String(
                      (report.sections?.length || 0) + sectionOffset + (report.recommendedActions && report.recommendedActions.length > 0 ? 2 : 1)
                    ).padStart(2, "0")}
                  </span>
                  <h2 className="font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-[#0C1B33]">
                    Data Sources
                  </h2>
                </div>
                <hr className="border-[#0C1B33]/8 mb-5" />
                <p className="text-[#0C1B33]/35 text-[13px] leading-relaxed mb-5 max-w-prose">
                  This report cites the sources used to show mapped screening signals and location context.
                </p>
                <ul className="space-y-3">
                  {report.dataSources.map((src) => (
                    <li key={src.id} className="text-[13px] leading-relaxed">
                      <span className="text-[#0C1B33]/70 font-semibold">{src.label}</span>
                      <span className="text-[#0C1B33]/40"> — {src.description}</span>
                      {src.url && (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 ml-2 text-[11px] text-[#0C1B33]/40 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide print-url"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          Link
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Government Resources ── */}
            {!showPersonaView && <div className="mt-16 pt-8 border-t border-[#0C1B33]/8">
              <span className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-5">
                Government Resources
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">City of Chicago</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Dept. of Planning &amp; Development
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+13127444190" className="hover:text-[#0C1B33] transition-colors print-url">(312) 744-4190</a>
                  </p>
                  <a
                    href="https://www.chicago.gov/city/en/depts/dcd.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    chicago.gov/dcd
                  </a>
                </div>
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">Cook County</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Bureau of Economic Development
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+13126033070" className="hover:text-[#0C1B33] transition-colors print-url">(312) 603-3070</a>
                  </p>
                  <a
                    href="https://www.cookcountyil.gov/service/economic-development"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    cookcountyil.gov
                  </a>
                </div>
                <div>
                  <p className="text-[#0C1B33]/70 text-[13px] font-semibold mb-1">State of Illinois</p>
                  <p className="text-[#0C1B33]/40 text-[12px] leading-relaxed mb-1.5">
                    Dept. of Commerce &amp; Economic Opportunity
                  </p>
                  <p className="text-[#0C1B33]/40 text-[11px] leading-relaxed">
                    <a href="tel:+12178146732" className="hover:text-[#0C1B33] transition-colors print-url">(217) 814-6732</a>
                  </p>
                  <a
                    href="https://dceo.illinois.gov"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#0C1B33]/35 hover:text-[#0C1B33] transition-colors font-mono-bureau tracking-wide mt-1 print-url"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    dceo.illinois.gov
                  </a>
                </div>
              </div>
            </div>}

            {/* ── Footer ── */}
            {showPersonaView ? (
              <PersonaReportFooter report={report} />
            ) : (
            <div className="report-footer mt-8 pt-6 border-t border-dashed border-[#0C1B33]/15">
              <p className="text-[#0C1B33]/35 text-[12px] leading-relaxed mb-2">
                This report was generated on {formattedDate} by Chicago
                Incentive Explorer.
              </p>
              <p className="text-[#0C1B33]/25 text-[11px] leading-relaxed">
                Program details, funding rounds, and eligibility rules change over
                time. This is an informational tool &mdash; confirm eligibility
                with program administrators.
              </p>
            </div>
            )}
          </div>
        </div>

        {/* Persona switching remains available without becoming an extra
            section inside the closed R5 report paper. */}
        {showPersonaLens && showPersonaView && !compact && (
          <div className="mx-auto mt-4 max-w-[850px] overflow-hidden bg-white shadow-sm print:hidden">
            <PersonaChips
              persona={persona}
              onSelect={handlePersonaSelect}
              report={report}
            />
            {isFramedPersonaLink && persona !== DEFAULT_PERSONA && (
              <div
                data-testid="framed-persona-notice"
                className="flex items-center gap-2 border-t border-[#0C1B33]/8 bg-[#EFF3FB] px-5 py-2.5 text-[11px] text-[#0C1B33]/70 sm:px-12 md:px-16"
              >
                <span>
                  Viewing as <strong className="font-semibold">{personaLabel(persona)}</strong> — the
                  lens this link was shared with.
                </span>
                <button
                  type="button"
                  onClick={() => handlePersonaSelect(DEFAULT_PERSONA)}
                  className="cursor-pointer font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#2563EB] hover:underline"
                >
                  Switch to All for everything
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Action Buttons (outside the document) ── */}
        <div className={`report-actions mx-auto max-w-[850px] print:hidden mt-8 ${compact ? "hidden" : ""}`}>
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3">
            <ReportActionButtons
              report={report}
              wizardState={reportWizardState}
              isDrawnAreaReport={isDrawnAreaReport}
              linkCopied={linkCopied}
              onDownload={handlePrint}
              onSave={handleSaveReport}
              onEmail={handleEmailReportClick}
              onShare={handleShareReport}
              afterSave={(
                <>
                  <StartPreparationPacketButton
                    report={report}
                    wizardState={reportWizardState}
                    source={`${analyticsSource}_report_actions`}
                    className="w-full sm:w-auto px-8 py-3.5 shadow-md"
                  />
                  {/* Saved-report surface only — section 3.6. /report has
                      never carried this control; adding it there is a
                      visible change and a separate decision. */}
                  {showWatchAreaAction &&
                    report.metadata?.lat != null &&
                    report.metadata?.lon != null && (
                      <WatchAreaButton
                        lat={report.metadata.lat}
                        lon={report.metadata.lon}
                        label={report.metadata?.address || report.title}
                        callbackUrl={`/map?lat=${report.metadata.lat}&lon=${report.metadata.lon}&label=${encodeURIComponent(report.metadata?.address || report.title)}`}
                        variant="action"
                      />
                    )}
                </>
              )}
              afterEmail={<VacancySpreadsheetCsvCtaButton vacancy={vacancy} />}
            />
            {/* The Brief (gate finding 8, spec v2 item 5): a one-page,
                forwardable summary — only offered on a real persona lens.
                Matches app/report/page.tsx's own button exactly. */}
            {showPersonaLens && persona !== DEFAULT_PERSONA && reportWizardState && (
              <button
                onClick={() => setBriefState((prev) => ({ ...prev, askOpen: true }))}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                <FileText className="w-3.5 h-3.5" />
                Build My Brief
              </button>
            )}
            {!compact && onCompare && !compareMode && (
              <button
                onClick={onCompare}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
              >
                <MapPin className="w-3.5 h-3.5" />
                Compare Another Address
              </button>
            )}
            {/* Refine intentionally lives only in the top value panel — it
                previously competed with 8 same-weight buttons here (audit
                RF5). PR #49's refine_clicked keeps firing from the panel
                with location "banner"; "action_row" retires with the button. */}
            <button
              onClick={onStartOver}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white border border-[#0C1B33]/15 text-[#0C1B33]/60 font-mono-bureau text-[10px] tracking-[0.15em] uppercase px-8 py-3.5 hover:border-[#0C1B33]/30 hover:text-[#0C1B33] transition-colors cursor-pointer shadow-md"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {isInstantMode ? "New Search" : "Start Over"}
            </button>
          </div>

          {/* Compare address input */}
          {compareMode && !compareGeoResult && (
            <div className="mt-5 mx-auto max-w-md">
              <label className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/30 block mb-2">
                Enter a second address to compare
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={compareAddressInput || ""}
                  onChange={(e) => setCompareAddressInput?.(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") onCompareGeocode?.(); }}
                  placeholder="e.g. 200 N LaSalle St, Chicago"
                  className="flex-1 px-4 py-3 bg-white border border-[#0C1B33]/15 text-[13px] text-[#0C1B33] placeholder:text-[#0C1B33]/25 focus:outline-none focus:border-[#0C1B33]/30 font-mono-bureau"
                />
                <button
                  onClick={onCompareGeocode}
                  disabled={compareGeocoding || !compareAddressInput?.trim()}
                  className="px-5 py-3 bg-[#0C1B33] text-white font-mono-bureau text-[10px] tracking-[0.15em] uppercase hover:bg-[#0C1B33]/80 transition-colors disabled:opacity-30 cursor-pointer"
                >
                  {compareGeocoding ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* R1 finding 1: a failed comparison generation used to say nothing
              at all. It says so here, and offers the same lookup again — which
              re-arms the comparison generation effect on the same address. */}
          {compareMode && comparisonFailed && (
            <div
              data-testid="comparison-generation-error"
              className="mt-5 mx-auto max-w-md border border-[#0C1B33]/15 bg-white px-4 py-3"
            >
              <p className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/45">
                {REPORT_GENERATION_FAILURE_COPY.comparison.eyebrow}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-[#0C1B33]/65">
                {REPORT_GENERATION_FAILURE_COPY.comparison.body}
              </p>
              <button
                type="button"
                onClick={onCompareGeocode}
                disabled={compareGeocoding}
                className="mt-3 inline-flex min-h-9 items-center bg-[#2563EB] px-3 py-2 font-mono-bureau text-[10px] uppercase tracking-[0.13em] text-white transition-colors hover:bg-[#1D4ED8] disabled:opacity-40"
              >
                {REPORT_GENERATION_FAILURE_COPY.comparison.retryLabel}
              </button>
            </div>
          )}

          {/* Compare loading state */}
          {compareMode && compareGeoResult && !compareGeoResult && (
            <div className="mt-5 text-center">
              <div className="flex gap-1.5 justify-center mb-2">
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" />
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
                <div className="w-1.5 h-1.5 bg-[#0C1B33]/20 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
              </div>
              <p className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-[#0C1B33]/30">
                Generating comparison report...
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Download Lead Capture */}
      {downloadGateOpen && (
        <DownloadGateModal
          reportAddress={report.metadata?.address}
          reportTitle={report.title}
          onDownload={handleDownloadAfterCapture}
          onClose={() => setDownloadGateOpen(false)}
          allowSkip={allowDownloadGateSkip}
        />
      )}
      {/* Email Report Dialog */}
      {emailDialogOpen && (
        <EmailReportModal
          report={report}
          onClose={() => setEmailDialogOpen(false)}
          onSent={() => trackEvent("report_emailed", reportAnalyticsPayload(report, "report_email_modal"))}
        />
      )}
      {saveModalOpen && (
        <SaveReportModal
          reportData={report}
          wizardState={reportWizardState}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
      {/* The Brief (gate finding 8, spec v2 item 5): the two-question ask,
          then the one-page shareable itself. Both read the SAME lensed
          report — no second generation path. Matches app/report/page.tsx's
          own block exactly — the workspace/saved-report fork previously
          had NO Brief at all, a documented gap now closed. */}
      {briefState.askOpen && (
        <BriefStageAsk
          onComplete={handleBriefComplete}
          onCancel={() => setBriefState((prev) => ({ ...prev, askOpen: false }))}
        />
      )}
      {briefState.open && briefState.stage && briefState.priority && (
        <div id="brief-overlay" className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4">
          <div className="mx-auto flex max-w-[860px] flex-col gap-3 py-6">
            <div className="flex items-center justify-between gap-3 print:hidden">
              <span className="font-mono-bureau text-[10px] tracking-[0.15em] uppercase text-white">
                The Brief
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBriefPrint}
                  className="inline-flex items-center gap-2 bg-[#2563EB] px-4 py-2.5 font-mono-bureau text-[9.5px] tracking-[0.1em] uppercase text-white"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print (2-up)
                </button>
                <button
                  type="button"
                  onClick={() => setBriefState((prev) => ({ ...prev, open: false }))}
                  className="inline-flex items-center gap-2 border border-white/30 px-4 py-2.5 font-mono-bureau text-[9.5px] tracking-[0.1em] uppercase text-white"
                >
                  Close
                </button>
              </div>
            </div>
            <div id="brief-print-2up" className="grid grid-cols-1 gap-4 print:grid-cols-2 print:gap-[0.3in]">
              <BriefPage
                report={lensed}
                persona={persona}
                stage={briefState.stage}
                priority={briefState.priority}
                reportUrl={briefReportUrl}
              />
              {/* Second copy — screen-hidden, print-only. Two-up print CSS
                  (spec v2 item 5): the same brief twice on one landscape
                  sheet, for handing to two people or filing + carrying. */}
              <div className="hidden print:block">
                <BriefPage
                  report={lensed}
                  persona={persona}
                  stage={briefState.stage}
                  priority={briefState.priority}
                  reportUrl={briefReportUrl}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
