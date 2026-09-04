"use client";

import { ChevronRight } from "lucide-react";
import { formatMiles } from "@/lib/transport-access";
import type { SiteSignalRecordGroup } from "@/lib/site-signals";

/**
 * Back-tracing for the nearby public-record counts. The count rows on the
 * dossier card and the snapshot panel say how many records are nearby; this
 * disclosure says WHICH records, with the identifier and the agency source a
 * reader needs to look each one up. Native <details>/<summary>, collapsed by
 * default, matching the disclosure pattern already used by DossierSection.
 *
 * The count row itself is unchanged when there is nothing to expand (an older
 * persisted `SiteSignals` with no `records`): callers get the same plain row
 * they had before.
 */
export interface NearbyRecordDisclosureProps {
  label: string;
  value: string | number;
  group: SiteSignalRecordGroup;
  variant: "dossier" | "compact";
  /** Compact-variant value color, matching the row it replaces. */
  valueClassName?: string;
  /** Dossier-variant truncated label ("truncate" on long names). */
  truncateLabel?: boolean;
}

export default function NearbyRecordDisclosure({
  label,
  value,
  group,
  variant,
  valueClassName,
  truncateLabel,
}: NearbyRecordDisclosureProps) {
  const compact = variant === "compact";

  const summaryRow = compact ? (
    <>
      <span className={`text-[#0C1B33]/50 ${truncateLabel ? "truncate" : ""}`}>{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <span className={valueClassName ?? "font-mono-bureau text-[#0C1B33]/80"}>{value}</span>
        <ChevronRight
          aria-hidden="true"
          className="h-2.5 w-2.5 text-[#0C1B33]/30 transition-transform group-open:rotate-90"
          strokeWidth={2}
        />
      </span>
    </>
  ) : (
    <>
      <span className="text-[#5A6478]">{label}</span>
      <span className="flex max-w-[58%] shrink-0 items-center gap-1.5 text-right font-medium text-[#0C1B33]">
        {value}
        <ChevronRight
          aria-hidden="true"
          className="h-3 w-3 shrink-0 text-[#8A93A6] transition-transform group-open:rotate-90"
          strokeWidth={2}
        />
      </span>
    </>
  );

  if (group.records.length === 0) {
    // Nothing to trace back to — keep the original, non-interactive row.
    return compact ? (
      <div className="flex items-baseline justify-between gap-2 text-[10px]">
        <span className={`text-[#0C1B33]/50 ${truncateLabel ? "truncate" : ""}`}>{label}</span>
        <span className={`shrink-0 ${valueClassName ?? "font-mono-bureau text-[#0C1B33]/80"}`}>
          {value}
        </span>
      </div>
    ) : (
      <div className="flex items-start justify-between gap-4">
        <span className="text-[#5A6478]">{label}</span>
        <span className="max-w-[58%] text-right font-medium text-[#0C1B33]">{value}</span>
      </div>
    );
  }

  return (
    <details className="group">
      <summary
        className={
          compact
            ? "flex cursor-pointer list-none items-baseline justify-between gap-2 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2563EB] [&::-webkit-details-marker]:hidden"
            : "flex cursor-pointer list-none items-start justify-between gap-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2563EB] [&::-webkit-details-marker]:hidden"
        }
      >
        {summaryRow}
      </summary>
      <ul
        className={
          compact
            ? "mt-1.5 space-y-1.5 border-l border-[#0C1B33]/10 pl-2"
            : "mt-2 space-y-2 border-l border-[#0C1B33]/10 pl-2.5"
        }
      >
        {group.records.map((record) => (
          <li key={record.id}>
            <div
              className={
                compact
                  ? "text-[10px] font-medium text-[#0C1B33]/80"
                  : "text-[11px] font-medium text-[#0C1B33]"
              }
            >
              {record.name}
            </div>
            <div className={compact ? "text-[9px] text-[#0C1B33]/45" : "text-[10px] text-[#5A6478]"}>
              {[record.address, formatMiles(record.miles)].filter(Boolean).join(" · ")}
            </div>
            {record.facts.length > 0 ? (
              <div
                className={
                  compact ? "text-[9px] text-[#0C1B33]/40" : "text-[9px] leading-relaxed text-[#8A93A6]"
                }
              >
                {record.facts.join(" · ")}
              </div>
            ) : null}
            {record.sourceUrl ? (
              <a
                href={record.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${compact ? "text-[9px]" : "text-[10px]"} text-[#2563EB] underline underline-offset-2`}
              >
                Source: {record.sourceLabel}
              </a>
            ) : (
              <div className={compact ? "text-[9px] text-[#0C1B33]/40" : "text-[9px] text-[#8A93A6]"}>
                Source: {record.sourceLabel}
              </div>
            )}
          </li>
        ))}
        {group.truncated > 0 ? (
          <li
            className={
              compact ? "text-[9px] italic text-[#0C1B33]/40" : "text-[9px] italic text-[#8A93A6]"
            }
          >
            and {group.truncated} more
          </li>
        ) : null}
      </ul>
    </details>
  );
}
