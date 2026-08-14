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
  {
    id: "survey-score-api",
    description: "POST /api/survey/score — server-side survey-engine execution for /qualify; returns a SurveyResult, never a raw Program.",
    contracts: ["PublicProgramView"],
    files: ["app/api/survey/score/route.ts"],
    findings: ["S11"],
  },

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
  {
    id: "qualify-survey",
    description: "The /qualify survey wizard and results.",
    contracts: ["PublicProgramView", "reviewed-copy"],
    files: ["app/qualify", "components/survey/SurveyResults.tsx", "lib/survey-engine.ts"],
    findings: ["F12"],
  },

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
    id: "shortlist-locate",
    description: "The /locate shortlist tool and its API/export.",
    contracts: ["ZoneEvidence"],
    files: ["app/locate", "app/api/shortlist", "app/vacancy/[zip]/shortlist"],
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
