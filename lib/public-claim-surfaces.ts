/**
 * lib/public-claim-surfaces.ts — the M0 public-surface registry
 * (build-spec.md 2.1; consult item 1, "BLOCKING": no existing mechanism
 * owned completeness across HTML, metadata, JSON-LD, APIs, PDFs, email,
 * exports, persisted reports, and concierge responses).
 *
 * Every surface that can show a real person a claim about a program,
 * boundary, or eligibility status — anywhere outside a comment or an
 * internal admin tool — is enumerated here, with which CLAIM CONTRACT it is
 * responsible for rendering from:
 *
 *   - "PublicProgramView" — must render program facts (status, benefit
 *     terms, published criteria) from lib/program-public.ts's DTO, not raw
 *     `Program`/catalog prose. See build-spec.md 2.2 (audit F4/F5/F6/F7/F9).
 *   - "ZoneEvidence"       — must render location/boundary claims from Zone
 *     Evidence v2's tri-state layers (lib/zone-response.ts's
 *     normalizeZoneEvidenceV2 / lib/zones-check.ts's resolveZoneEvidenceV2),
 *     never a v1 positives-only array defaulted to false. See build-spec.md
 *     2.3 (audit F2).
 *   - "reviewed-copy"      — carries hand-authored prose that is not
 *     derived from either producer above (a screening-signal frame,
 *     authority-routing copy, a disclaimer). Its safety is established by a
 *     dedicated rendered-output test (build-spec.md 2.4/2.9), not by a
 *     schema.
 *
 * A surface may need more than one contract (e.g. the address report
 * renders both program facts and zone evidence) — list every contract it
 * is responsible for.
 *
 * THIS REGISTRY IS CHECKED, NOT DECORATIVE: lib/__tests__/public-claim-
 * surfaces.test.ts asserts every entry has a non-empty id/description, a
 * valid contract list, and that every listed file actually exists in the
 * repo — a renamed/deleted file desyncs the registry from reality and the
 * test catches it. New public claim sinks MUST be added here as part of
 * the same change that introduces them; nothing enforces that
 * automatically (there is no build-time "you forgot to register this"
 * check — this is documentation with a freshness test, not a linter).
 */

export type ClaimContract = "PublicProgramView" | "ZoneEvidence" | "reviewed-copy";

export interface PublicClaimSurface {
  /** Short stable identifier, kebab-case. Referenced by acceptance-doc rows. */
  id: string;
  /** One line: what a real visitor sees here. */
  description: string;
  /** Every claim contract this surface is responsible for rendering from. */
  contracts: readonly ClaimContract[];
  /** Repo-relative paths (files or directories) that implement this surface. */
  files: readonly string[];
  /** Which audit finding(s) this surface was named in, if any (F1–F16, "M3", etc.) — omitted when the surface was added purely for registry completeness. */
  findings?: readonly string[];
}

export const PUBLIC_CLAIM_SURFACES: readonly PublicClaimSurface[] = [
  // ── Address report (both forks) ──────────────────────────────────────
  {
    id: "report-live-route",
    description: "The live /report address-report page (wizard + display).",
    contracts: ["PublicProgramView", "ZoneEvidence", "reviewed-copy"],
    files: ["app/report/page.tsx"],
    findings: ["F13", "F14"],
  },
  {
    id: "report-saved-fork",
    description: "The saved/shared-report renderer (persisted report fork).",
    contracts: ["PublicProgramView", "ZoneEvidence", "reviewed-copy"],
    files: ["components/report/ReportDisplay.tsx"],
    findings: ["F13"],
  },
  {
    id: "report-pdf",
    description: "The current generated-report PDF export pipeline.",
    contracts: ["PublicProgramView", "ZoneEvidence", "reviewed-copy"],
    files: ["lib/pdf-report.ts"],
  },
  {
    // Gate finding 12: this component's own file-header comment says every
    // field it renders is "derived at generation time from real catalog
    // data" — a PublicProgramView-shaped claim surface — but it was never
    // added to this registry when introduced. Shared by both report forks
    // (report-live-route, report-saved-fork already cover the pages that
    // render it; this entry tracks the component itself so a future rename
    // or deletion is caught by this registry's own freshness test).
    id: "program-card-extras",
    description: "Program-card content extras (Can combine with / What to expect / Verify at the source / Cost signals), shared by both report forks.",
    contracts: ["PublicProgramView"],
    files: ["components/report/ProgramCardExtras.tsx"],
  },
  {
    // Gate round 2, BLOCKER 12: registered alongside program-card-extras
    // for the same reason — a PublicProgramView-shaped card-face surface
    // that was never added to this registry when introduced.
    id: "program-card-face",
    description: "Program-card face content — administrator, status/window pills, glance row, \"Commonly required,\" next-step/contact — shared by both report forks.",
    contracts: ["PublicProgramView"],
    files: ["components/report/ProgramCardFace.tsx"],
  },
  {
    id: "reason-chips",
    description: "Program-card \"Why this is shown\" reason pills, shared by both report forks.",
    contracts: ["PublicProgramView"],
    files: ["components/report/ReasonChips.tsx"],
  },
  {
    id: "corridor-investment-chart",
    description: "Supporter persona's corridor small-business-lending-by-year chart (real FFIEC CRA series), shared by both report forks.",
    contracts: ["PublicProgramView"],
    files: ["components/report/CorridorInvestmentChart.tsx"],
  },
  {
    id: "looking-overview",
    description: "\"Just looking\" persona's Location snapshot / What's notable / Explore by interest panels, shared by both report forks.",
    contracts: ["PublicProgramView"],
    files: ["components/report/LookingOverview.tsx"],
  },
  {
    id: "persona-report-chrome",
    description: "Persona-board header, lensed executive summary, guidepost bands, compact Also line, and public-record footer shared by both report forks.",
    contracts: ["PublicProgramView", "ZoneEvidence", "reviewed-copy"],
    files: ["components/report/PersonaReportChrome.tsx"],
  },
  {
    id: "persona-report-supplements",
    description: "Board-positioned persona charts and document-readiness sections, sourced from the canonical report and filtered to the visible lens.",
    contracts: ["PublicProgramView", "reviewed-copy"],
    files: ["components/report/PersonaSectionSupplements.tsx"],
  },
  {
    id: "the-brief",
    description: "The Brief — the one-page shareable summary and its two-question ask, built from the same lensed report the online view shows.",
    contracts: ["PublicProgramView", "reviewed-copy"],
    files: ["components/report/BriefPage.tsx", "components/report/BriefStageAsk.tsx"],
  },
  {
    id: "report-email",
    description: "Report-summary email routes and the shared email-content helpers (program count, sections).",
    contracts: ["PublicProgramView", "reviewed-copy"],
    files: ["app/api/email-report/route.ts", "lib/report-email.ts", "lib/report-email-delivery.ts", "components/report/ReportModals.tsx"],
    findings: ["F14"],
  },
  {
    id: "saved-reports-api",
    description: "Persisted saved-report read/write API.",
    contracts: ["PublicProgramView", "ZoneEvidence"],
    files: ["app/api/saved-reports"],
  },
  {
    // Email-gate redesign: registered out of the report-component gaps
    // baseline as part of this rewrite (new copy — the 48-hour support
    // promise, the mandatory persona+goal helper line, the footer — all
    // reviewed against the goal-independent PDF/email/save mechanisms it
    // actually wires to). See components/report/__tests__/report-email-gate.test.tsx
    // for the dedicated rendered-output check (gate review round 1,
    // MINOR finding 14 — this comment previously pointed at
    // lib/__tests__/report-email-gate.test.tsx, which does not exist).
    id: "report-email-gate",
    description: "The mandatory persona+goal report gate: 8 grouped goal chips, optional 1-on-1 support opt-in, and the save-report affordance.",
    contracts: ["reviewed-copy"],
    files: ["components/report/ReportEmailGate.tsx"],
  },
  {
    // Email-gate redesign, spec §D: the optional support opt-in's lead
    // capture + chamber-inbox notification, reusing report-email's own
    // createReportLead/Resend mechanism without also emailing the visitor
    // a PDF (the support box promises a follow-up, never report delivery).
    id: "support-request-api",
    description: "Optional 1-on-1 support opt-in lead capture and chamber-inbox notification (gate's 'Want a hand?' box).",
    contracts: ["reviewed-copy"],
    files: ["app/api/support-request/route.ts", "lib/support-lead.ts"],
  },
  {
    // Email-gate redesign, spec §C: registered out of the report-component
    // gaps baseline for the same reason as report-email-gate above — new
    // copy (the inline funding-window email offer), reviewed against the
    // real send mechanism it actually uses (no fabricated future-reminder
    // promise — see the component's own doc comment and
    // lib/__tests__/goal-coverage.test.ts's sibling test file,
    // components/report/__tests__/funding-window-email-offer.test.tsx).
    id: "funding-window-email-offer",
    description: "Inline, dismissible email offer beside the SBIF funding-window chart — sends the report immediately via the existing report-email mechanism.",
    contracts: ["reviewed-copy"],
    files: ["components/report/FundingWindowChart.tsx"],
  },

  // ── Vacancy / owner-file / handoff PDFs ──────────────────────────────
  {
    id: "vacancy-report",
    description: "The public /vacancy/[zip]/report web page and its adapter.",
    contracts: ["ZoneEvidence", "reviewed-copy"],
    files: ["app/vacancy/[zip]/report", "lib/vacancy-index-adapter.ts"],
    findings: ["F1"],
  },
  {
    id: "vacancy-index-pdf",
    description: "The partner-facing vacancy-index PDF export.",
    contracts: ["ZoneEvidence", "reviewed-copy"],
    files: ["lib/vacancy-index-pdf.ts"],
    findings: ["F1"],
  },
  {
    id: "owner-file-pdf",
    description: "The owner-file letter/report PDF export.",
    contracts: ["PublicProgramView", "ZoneEvidence"],
    files: ["lib/owner-file-pdf.ts", "lib/owner-file-letter-context.ts"],
  },
  {
    id: "handoff-one-pager",
    description: "The single-page zoning-question handoff PDF and its share text.",
    contracts: ["reviewed-copy"],
    files: ["lib/handoff-pdf.ts", "lib/stage-handoff.ts", "components/zoning/StageHandoffButton.tsx"],
    findings: ["F10"],
  },

  // ── Programs catalog / program pages / API ───────────────────────────
  {
    id: "programs-catalog",
    description: "The public program directory, cards, and printable matrix.",
    contracts: ["PublicProgramView"],
    files: ["components/programs/ProgramsCatalog.tsx"],
    findings: ["F4"],
  },
  {
    id: "program-detail-pages",
    description: "Per-program detail pages, metadata, and JSON-LD.",
    contracts: ["PublicProgramView"],
    files: ["app/programs/[slug]/page.tsx"],
    findings: ["F3", "F4", "F5"],
  },
  {
    id: "programs-api",
    description: "GET /api/programs — DB-first with static-catalog fallback.",
    contracts: ["PublicProgramView"],
    files: ["app/api/programs/route.ts"],
    findings: ["F4"],
  },
  {
    id: "program-seo-overrides",
    description: "Hand-authored SEO title/description overrides for program pages.",
    contracts: ["reviewed-copy"],
    files: ["lib/program-seo-overrides.ts"],
  },
  // review6 S11/S16: three server-only engine-execution routes that
  // replaced the deleted /api/programs/engine-source (the S11 leak) —
  // each runs a client engine (confidence/report/survey) against the
  // full internal catalog SERVER-SIDE and returns only the engine's
  // already-narrow RESULT, never the raw catalog. Registered here per
  // S16's discovery requirement ("every public sink... must have a
  // registry entry" — these three were the exact gap: new S11 routes
  // that shipped without ever being added to this registry).
  {
    id: "programs-match-api",
    description: "POST /api/programs/match — server-side confidence-engine execution for the map click snapshot; returns SafeMapProgramMatch[], never a raw Program.",
    contracts: ["PublicProgramView"],
    files: ["app/api/programs/match/route.ts"],
    findings: ["S11"],
  },
  {
    id: "report-generate-api",
    description: "POST /api/report/generate — server-side report-engine execution for app/report/page.tsx's wizard; returns a GeneratedReport, never a raw Program.",
    contracts: ["PublicProgramView"],
    files: ["app/api/report/generate/route.ts"],
    findings: ["S11"],
  },
  // review9 (sunset /qualify + vacant-sites report cross-links): the
  // "survey-score-api" entry (POST /api/survey/score) was removed here —
  // the route, its lib/survey-engine.ts engine, and the whole
  // components/survey/ UI it served were deleted outright, not
  // re-registered. See the "qualify-survey" removal below for the other
  // half of the same deletion.

  // ── SEO / content pages ───────────────────────────────────────────────
  {
    id: "faq-page",
    description: "The public FAQ page.",
    contracts: ["PublicProgramView", "reviewed-copy"],
    files: ["app/faq/page.tsx"],
    findings: ["F6", "F11"],
  },
  {
    id: "answers-pages",
    description: "Indexable /answers/[slug] SEO pages and their JSON-LD.",
    contracts: ["PublicProgramView", "reviewed-copy"],
    files: ["app/answers/[slug]/page.tsx", "lib/answers-data.ts"],
    findings: ["F7", "F8", "F11"],
  },
  {
    id: "neighborhood-pages",
    description: "Per-neighborhood incentive SEO pages and metadata.",
    contracts: ["PublicProgramView", "ZoneEvidence", "reviewed-copy"],
    files: ["app/neighborhoods/[slug]/incentives/page.tsx"],
    findings: ["F8"],
  },
  {
    id: "quiz",
    description: "The /quiz program-fact quiz bank.",
    contracts: ["PublicProgramView"],
    files: ["app/quiz", "lib/quiz-bank-extension.ts"],
    findings: ["F9"],
  },
  // review9 (sunset /qualify + vacant-sites report cross-links): the
  // "qualify-survey" entry (app/qualify, components/survey/SurveyResults.tsx,
  // lib/survey-engine.ts) was removed here — owner's ruling was "the
  // compliance-flavored Q&A disappears entirely," not that it gets
  // re-pointed. app/qualify/ is gone outright (a permanent redirect to "/"
  // lives in next.config.ts instead, pinned by
  // lib/__tests__/qualify-retirement.test.ts); components/survey/ and
  // lib/survey-engine.ts were fully orphaned (zero living importers,
  // verified before deletion) and deleted with it.

  // ── Quick check / map / shortlist ────────────────────────────────────
  {
    id: "quick-check",
    description: "The /check zero-form address-check surface.",
    contracts: ["ZoneEvidence"],
    files: ["components/check/QuickCheckClient.tsx", "lib/vacancy-site-zones.ts"],
    findings: ["F2"],
  },
  {
    id: "map-panels",
    description: "Map dossier/snapshot/polygon panels and the zone legend.",
    contracts: ["PublicProgramView", "ZoneEvidence", "reviewed-copy"],
    files: [
      "components/map/MapDossierCard.tsx",
      "components/map/MapSnapshotPanel.tsx",
      "components/map/MapPolygonPanel.tsx",
      "components/map/MapView.tsx",
      "lib/constants.ts",
    ],
    findings: ["F2", "F14"],
  },
  {
    id: "neighborhood-permit-analysis",
    description: "The neighborhood permit-activity evidence brief, its official-boundary data endpoint, and downloadable source-record summary.",
    contracts: ["reviewed-copy"],
    files: [
      "app/permit-activity",
      "app/api/permit-area/route.ts",
      "lib/permit-area.ts",
    ],
  },
  {
    // Permit History Exhibit — PR 1 (evidence spine, lib/permit-exhibit.ts)
    // owns the S1/S3/S4 verbatim reviewed copy (self-reported-cost label,
    // boundary honest-limit line, methods & limits block, coverage note).
    // PR 2 (this entry's `files` extension) wires the gated UI surface that
    // renders it: the /permit-exhibit entry + [pin] exhibit page, the
    // /print/permit-exhibit print route, the section/gate/entry-form
    // components, and PR2's own surface-chrome copy
    // (lib/permit-exhibit-copy.ts) — extended here per this entry's
    // original comment rather than opening a duplicate entry.
    id: "permit-exhibit-evidence-spine",
    description: "The Permit History Exhibit: evidence-spine library (subject-parcel/area permit matching, boundary-context honest limits, S4 methods & limits copy) plus the gated entry/exhibit/print surface and its access gate.",
    contracts: ["reviewed-copy"],
    files: [
      "lib/permit-exhibit.ts",
      "lib/permit-exhibit-copy.ts",
      "lib/permit-exhibit-source.ts",
      "app/permit-exhibit",
      "app/print/permit-exhibit",
      "app/api/permit-exhibit-snapshots/route.ts",
      "components/permit-exhibit",
    ],
  },
  {
    id: "public-investment-beta-access",
    description: "The Public Investment Analysis beta request, email-verification, staff-approval, passwordless access, and private operations surfaces.",
    contracts: ["reviewed-copy"],
    files: [
      "app/public-investment-analysis",
      "app/api/public-investment-early-access/route.ts",
      "app/api/public-investment-early-access/verify/route.ts",
      "app/api/public-investment-early-access/sign-in/route.ts",
      "app/api/admin/public-investment-early-access/route.ts",
      "app/api/admin/public-investment-early-access/[id]/decision/route.ts",
      "app/admin/public-investment-access",
      "app/public-investment-analysis/verify",
      "app/public-investment-analysis/sign-in",
      "app/investment/gate.tsx",
      "auth.ts",
      "lib/public-investment-access-email.ts",
      "lib/public-investment-early-access.ts",
      "lib/public-investment-early-access-storage.ts",
    ],
  },
  {
    id: "shortlist-locate",
    description: "The /locate shortlist tool, its API/export, and the signup gate protecting the final ranked output.",
    contracts: ["ZoneEvidence", "reviewed-copy"],
    files: [
      "app/locate",
      "app/api/shortlist",
      "app/api/shortlist-access/route.ts",
      "app/api/admin/shortlist-access/route.ts",
      "app/vacancy/[zip]/shortlist",
      "components/vacancy/ShortlistAccessGate.tsx",
      "lib/shortlist-access.ts",
      "lib/shortlist-access-storage.ts",
    ],
    findings: ["F2"],
  },

  // ── StartHere / concierge ─────────────────────────────────────────────
  {
    id: "start-here",
    description: "StartHere cards summarizing a ranked program/support match.",
    contracts: ["PublicProgramView"],
    files: ["lib/start-here.ts"],
  },
  {
    id: "concierge",
    description: "The Site Concierge chat surface (model-generated + fallback text) and its zone/program tools.",
    contracts: ["PublicProgramView", "ZoneEvidence", "reviewed-copy"],
    files: [
      "app/api/concierge/route.ts",
      "lib/concierge/tools.ts",
      "lib/concierge/fallback.ts",
      "lib/concierge/programs-index.ts",
    ],
  },

  // build-spec.md 2.7: the legacy-lookup-fork entry (IncentiveReport,
  // ZoneResultCard) that lived here through the geocode-then-route fix has
  // been removed along with the deleted files themselves — F15 is closed;
  // AddressSearch now routes every match (coordinate-bearing or
  // geocoded-on-demand) through /report, the same "report-live-route" entry
  // above already covers.
] as const;
