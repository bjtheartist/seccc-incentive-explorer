"use client";

/**
 * Record drawer (Sol #1): clicking a row in the [area] top-recipients table opens
 * a side drawer with the full record — amount + status badge, capital class,
 * source/program, year, address, location-confidence (sited vs citywide), and
 * links — with NO navigation away. The panel slides in from the right over a
 * dismiss scrim; Escape and the scrim both close it.
 *
 * Wiring: the area page wraps the "Top recipients" section in <RecordDrawerProvider>
 * and passes `drawerEnabled` to the (server) TopRecipientsTable, whose recipient
 * cell then renders a <RecordRowButton> — a client button that calls the context's
 * open(). Context flows from the client Provider to the client button across the
 * server table in between (the standard server-parent / client-leaves pattern).
 * The print brief renders the plain table without the provider, so no interactive
 * control ever reaches paper.
 *
 * Every dollar shown is an AWARDED grant amount (top recipients are all
 * amountAwarded>0 grant records) — the drawer never implies a received/available
 * balance.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { TopRecipient } from "@/lib/investment-analysis";
import {
  CAPITAL_CLASS_LABELS,
  CAPITAL_CLASS_MONEY_NOUN,
  investmentStatusLabel,
} from "@/lib/community-investment-layer";
import { GOVERNMENT_FUNDING_PURPOSE_LABELS } from "@/lib/government-funding-purpose";
import { formatFullDollars, SOURCE_LABELS } from "./format";

interface RecordDrawerContextValue {
  open: (record: TopRecipient) => void;
}

const RecordDrawerContext = createContext<RecordDrawerContextValue | null>(null);

/** Provider that holds the open record and renders the drawer. Wrap the section
 * whose rows should be openable. */
export function RecordDrawerProvider({ children }: { children: React.ReactNode }) {
  const [record, setRecord] = useState<TopRecipient | null>(null);
  const open = useCallback((r: TopRecipient) => setRecord(r), []);
  const close = useCallback(() => setRecord(null), []);

  return (
    <RecordDrawerContext.Provider value={{ open }}>
      {children}
      {record ? <RecordDrawer record={record} onClose={close} /> : null}
    </RecordDrawerContext.Provider>
  );
}

/**
 * A clickable trigger for one record. Rendered inside a table cell by
 * TopRecipientsTable when `drawerEnabled`. When it is NOT inside a provider (a
 * defensive fallback), it degrades to plain, non-interactive content.
 */
export function RecordRowButton({
  record,
  children,
}: {
  record: TopRecipient;
  children: React.ReactNode;
}) {
  const ctx = useContext(RecordDrawerContext);
  if (!ctx) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={() => ctx.open(record)}
      className="text-left font-medium text-[#0C1B33] underline decoration-[#0C1B33]/20 decoration-dotted underline-offset-2 hover:text-[#2563EB] hover:decoration-[#2563EB]"
    >
      {children}
    </button>
  );
}

/** A labeled definition-list row inside the drawer. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[#0C1B33]/8 py-3 first:border-t-0">
      <dt className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] leading-relaxed text-[#0C1B33]/80">{children}</dd>
    </div>
  );
}

function RecordDrawer({ record, onClose }: { record: TopRecipient; onClose: () => void }) {
  // Escape closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const moneyNoun = CAPITAL_CLASS_MONEY_NOUN[record.capitalClass] ?? "Awarded";
  const links = record.links.filter((l) => /^https?:\/\//i.test(l));

  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Record: ${record.recipient}`}>
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close record"
        onClick={onClose}
        className="absolute inset-0 bg-[#0C1B33]/30 backdrop-blur-[1px]"
      />
      {/* Panel */}
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[#0C1B33]/12 bg-[#FAF9F6] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#0C1B33]/10 bg-white px-5 py-4">
          <div className="min-w-0">
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#2563EB]">
              Record detail
            </span>
            <h3 className="mt-1 text-[18px] font-semibold leading-tight text-[#0C1B33]">
              {record.recipient}
            </h3>
            {record.funderName ? (
              <p className="mt-1 text-[12px] text-[#0C1B33]/55">{record.funderName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[3px] border border-[#0C1B33]/15 px-2 py-1 text-[13px] leading-none text-[#0C1B33]/50 hover:border-[#0C1B33]/35 hover:text-[#0C1B33]"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4">
          {/* Amount + status badge */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/40">
              {moneyNoun}
            </span>
            <span className="text-[24px] font-bold text-[#0C1B33] [font-variant-numeric:tabular-nums]">
              {formatFullDollars(record.amountAwarded)}
            </span>
            <span className="inline-flex items-center rounded-full border border-[#2563EB]/25 bg-[#2563EB]/[0.08] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#2563EB]">
              {investmentStatusLabel(record.status)}
            </span>
          </div>

          <dl className="mt-4">
            <Field label="Capital class">{CAPITAL_CLASS_LABELS[record.capitalClass] ?? "Grant"}</Field>
            {record.governmentFundingPurpose ? (
              <Field label="Government funding purpose">
                {GOVERNMENT_FUNDING_PURPOSE_LABELS[record.governmentFundingPurpose]}
              </Field>
            ) : null}
            <Field label="Program / source">{SOURCE_LABELS[record.source]}</Field>
            <Field label="Year">{record.year ?? "Not dated"}</Field>
            <Field label="Address">
              {record.address ? (
                record.address
              ) : (
                <span className="text-[#0C1B33]/45">No street address on record</span>
              )}
            </Field>
            <Field label="Location confidence">
              {record.locationConfidence === "sited" ? (
                <span>
                  Sited — plotted at a real address
                </span>
              ) : record.locationConfidence === "zip_area" ? (
                <span>
                  ZIP area — the source publishes a ZIP, not a street address
                </span>
              ) : (
                <span>
                  Citywide — held citywide, not plotted at a specific address
                </span>
              )}
            </Field>
            {record.logLine ? <Field label="Project">{record.logLine}</Field> : null}
            <Field label="Links">
              {links.length > 0 ? (
                <ul className="space-y-1">
                  {links.map((l) => (
                    <li key={l}>
                      <a
                        href={l}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-[12px] text-[#2563EB] underline underline-offset-2 hover:text-[#1D4ED8]"
                      >
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[#0C1B33]/45">No source link on record</span>
              )}
            </Field>
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-[#0C1B33]/40">
            Dollar figures are documented awarded amounts from public records — a commitment on paper,
            not proof of receipt.
          </p>
        </div>
      </aside>
    </div>
  );
}
