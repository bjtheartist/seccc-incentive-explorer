import { CountUpDollars } from "./CountUpDollars";
import { formatCompactDollars, formatFullDollars, formatAsOf } from "./format";

/**
 * The three-status grammar (Sol #2) that heads every Investment surface — landing,
 * per-area, and the print brief. Three NON-ADDITIVE metric cards, never one
 * combined total and never one shared color scale:
 *
 *   1. Known awarded dollars captured — documented commitments in the source set.
 *   2. Announced private capital — self-reported development price tags.
 *   3. Reported disbursements — payment evidence from an authoritative source.
 *
 * The third card is SCOPE-AWARE (audit finding 6 / consult F5 — this component
 * is shared by the citywide landing page, every per-community area page, and
 * the print brief, so one card must never read as though it belongs to all
 * three). "Closed recovery-program files report [meta.totalRecoveryHistorical]
 * disbursed" was true citywide but is NOT a per-community figure — no source
 * attributes recovery disbursements to a single community — so
 * `disbursement.scope`:
 *   - "citywide" (landing only) renders the real, meta-derived recovery total
 *     with the consult's exact sentence.
 *   - "not-applicable" (every area page + print) explicitly states the figure
 *     is citywide-only and is not shown here, rather than silently rendering
 *     a blank slot that could be misread as "this community has none."
 *
 * Beneath the three, a compact row surfaces the FOUR non-grant capital classes
 * — TIF authorized, federal program (CDBG/HOME), tax-credit capital, and the
 * published state appropriation balance (audit finding 7 / consult F8 — the
 * public model previously exposed only the first three of five capital
 * classes) — each labeled with its own noun and NEVER summed with the others
 * or with awarded dollars.
 *
 * Every dollar carries a status/source badge; the footer carries the as-of date
 * and a coverage link into the methodology rail. Server component: the awarded
 * figure count-up (web) comes from the client CountUpDollars child; print passes
 * animate={false} for a static value.
 */

/** A small status/source badge — the provenance chip every figure carries. */
function StatusBadge({ label, tone }: { label: string; tone: "documented" | "announced" | "pending" | "context" }) {
  const tones: Record<string, { fg: string; bg: string; bd: string }> = {
    documented: { fg: "#1D4ED8", bg: "rgba(37,99,235,0.08)", bd: "rgba(37,99,235,0.22)" },
    announced: { fg: "#6D28D9", bg: "rgba(124,58,237,0.08)", bd: "rgba(124,58,237,0.22)" },
    pending: { fg: "rgba(12,27,51,0.5)", bg: "rgba(12,27,51,0.04)", bd: "rgba(12,27,51,0.14)" },
    context: { fg: "#475569", bg: "rgba(71,85,105,0.08)", bd: "rgba(71,85,105,0.22)" },
  };
  const t = tones[tone];
  return (
    <span
      className="inline-block rounded-[2px] border px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-[0.08em]"
      style={{ color: t.fg, backgroundColor: t.bg, borderColor: t.bd }}
    >
      {label}
    </span>
  );
}

/**
 * The disbursement card's scope (audit finding 6 / consult F5). Required
 * (not optional-defaulted) so every caller makes an explicit scope decision
 * rather than silently inheriting a citywide figure it never asked for.
 */
export type StatusCardsDisbursement =
  | { scope: "citywide"; totalRecoveryDisbursed: number }
  | { scope: "not-applicable" };

export interface StatusCardsProps {
  /** Documented awarded dollars in scope (community-sited on the landing, this
   * community on an area page). */
  awarded: number;
  /** Announced private development capital in scope (a separate measure). */
  announced: number;
  /** The four non-grant capital classes, each reported under its own noun
   * (consult F8 — the fifth, published state appropriation balance, was
   * previously missing from the public model). */
  capital: {
    authorizedTif: number;
    federalProgram: number;
    creditCapital: number;
    publishedStateAppropriation: number;
  };
  /** ISO timestamp for the as-of line. */
  asOf: string;
  /** Anchor into the methodology / coverage rail on the same page. */
  coverageHref: string;
  /** false on print — render the awarded figure statically (no mid-animation PDF). */
  animate?: boolean;
  /** Overrides the awarded card's one-line scope note. */
  awardedNote?: string;
  /** Scope for the "Reported disbursements" card — see StatusCardsDisbursement. */
  disbursement: StatusCardsDisbursement;
}

/** One of the three primary status cards. */
function StatusCard({
  eyebrow,
  children,
  badge,
  note,
}: {
  eyebrow: string;
  children: React.ReactNode;
  badge: React.ReactNode;
  note: string;
}) {
  return (
    <div className="brief-figure flex flex-col border border-[#0C1B33]/10 bg-white px-5 py-5">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono-bureau text-[10px] uppercase leading-tight tracking-[0.16em] text-[#0C1B33]/50">
          {eyebrow}
        </span>
        {badge}
      </div>
      <div className="mt-3 flex-1">{children}</div>
      <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/45">{note}</p>
    </div>
  );
}

/** One capital-class metric in the compact non-grant row. */
function CapitalClassStat({ label, value, badge }: { label: string; value: number; badge: string }) {
  return (
    <div className="flex flex-col gap-1 border border-[#0C1B33]/10 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">{label}</span>
        <StatusBadge label={badge} tone="context" />
      </div>
      <span
        className="text-[19px] font-semibold leading-none text-[#0C1B33]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value > 0 ? formatCompactDollars(value) : "None on record"}
      </span>
    </div>
  );
}

export function StatusCards({
  awarded,
  announced,
  capital,
  asOf,
  coverageHref,
  animate = true,
  awardedNote = "Documented commitments sited to this scope, from public records. An award is a commitment on paper, not proof of receipt.",
  disbursement,
}: StatusCardsProps) {
  const isCitywideDisbursement = disbursement.scope === "citywide";
  // The consult's exact sentence (F5), with the dollar figure read live from
  // meta.totalRecoveryHistorical — never a hand-typed literal. formatCompactDollars
  // renders it in the same compact form the consult itself used.
  const disbursementNote = isCitywideDisbursement
    ? `Closed recovery-program files report ${formatCompactDollars(disbursement.totalRecoveryDisbursed)} disbursed; ordinary award, foundation, TIF, HUD, tax-credit, and appropriation sources do not report recipient receipts.`
    : "Closed recovery-program files report a disbursed total citywide — it is not shown on this page because it does not belong to any single community. Ordinary award, foundation, TIF, HUD, tax-credit, and appropriation sources do not report recipient receipts.";
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusCard
          eyebrow="Known awarded dollars captured since 2020"
          badge={<StatusBadge label="Documented" tone="documented" />}
          note={awardedNote}
        >
          <div
            className="text-[clamp(30px,4.4vw,42px)] font-semibold leading-none tracking-tight text-[#0C1B33]"
            style={{ fontVariantNumeric: "proportional-nums" }}
          >
            {animate ? <CountUpDollars value={awarded} /> : <span>{formatFullDollars(awarded)}</span>}
          </div>
        </StatusCard>

        <StatusCard
          eyebrow="Announced private capital"
          badge={<StatusBadge label="Announced" tone="announced" />}
          note="Self-reported total project costs for major private developments. A different measure from awarded grants — never combined with them."
        >
          <div
            className="text-[clamp(30px,4.4vw,42px)] font-semibold leading-none tracking-tight text-[#0C1B33]"
            style={{ fontVariantNumeric: "proportional-nums" }}
          >
            {announced > 0 ? formatCompactDollars(announced) : "None on record"}
          </div>
        </StatusCard>

        <StatusCard
          eyebrow="Reported disbursements"
          badge={
            isCitywideDisbursement ? (
              <StatusBadge label="Disbursed" tone="documented" />
            ) : (
              <StatusBadge label="Citywide only" tone="pending" />
            )
          }
          note={disbursementNote}
        >
          {isCitywideDisbursement ? (
            <div
              className="text-[clamp(30px,4.4vw,42px)] font-semibold leading-none tracking-tight text-[#0C1B33]"
              style={{ fontVariantNumeric: "proportional-nums" }}
            >
              {animate ? (
                <CountUpDollars value={disbursement.totalRecoveryDisbursed} />
              ) : (
                <span>{formatFullDollars(disbursement.totalRecoveryDisbursed)}</span>
              )}
            </div>
          ) : (
            <div className="text-[15px] font-medium leading-snug text-[#0C1B33]/45">
              Not shown on this page — citywide only
            </div>
          )}
        </StatusCard>
      </div>

      {/* Non-grant capital classes — each its own noun, never summed. Four
          classes (consult F8 — the published state appropriation balance was
          previously missing from the public model). */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CapitalClassStat label="TIF authorized" value={capital.authorizedTif} badge="Authorized" />
        <CapitalClassStat label="Federal program (CDBG/HOME)" value={capital.federalProgram} badge="Committed" />
        <CapitalClassStat label="Tax-credit capital (LIHTC/NMTC)" value={capital.creditCapital} badge="Allocated" />
        <CapitalClassStat
          label="State appropriation"
          value={capital.publishedStateAppropriation}
          badge="Published balance"
        />
      </div>

      <p className="mt-3 font-mono-bureau text-[10px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
        Data as of {formatAsOf(asOf)} ·{" "}
        <a href={coverageHref} className="underline decoration-[#0C1B33]/25 underline-offset-2 hover:text-[#2563EB]">
          Coverage &amp; methodology
        </a>{" "}
        · these three measures are never added together
      </p>
    </div>
  );
}
