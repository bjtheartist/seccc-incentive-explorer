import {
  DOCUMENT_PREPARATION_COST_UNKNOWN_BASIS,
  DOCUMENT_PREPARATION_COST_UNKNOWN_TIER,
  type DocumentPreparationCostSignal,
  type DocumentPreparationCostTier,
} from "@/lib/document-preparation-cost";

interface PreparationCostBadgeProps {
  signal: DocumentPreparationCostSignal;
  label?: string;
}

export function PreparationCostBadge({ signal, label = "Preparation" }: PreparationCostBadgeProps) {
  // The unknown tier is styled GREY, not the blue of a determined cost. A
  // reader scanning badges should be able to see at a glance which documents
  // were actually classified and which were not, without reading a tooltip.
  const unknown = signal.tier === DOCUMENT_PREPARATION_COST_UNKNOWN_TIER;
  const tone = unknown
    ? "border-[#0C1B33]/20 bg-[#0C1B33]/[0.03] text-[#0C1B33]/60"
    : "border-[#2563EB]/25 bg-[#2563EB]/[0.05] text-[#1D4ED8]";
  const spoken = unknown ? `${label} cost not determined` : `${label} cost ${signal.tier}`;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 border px-2 py-0.5 font-mono-bureau text-[8px] uppercase tracking-[0.1em] ${tone}`}
      title={`${label}: ${signal.basis}`}
      aria-label={`${spoken}. ${signal.basis}`}
    >
      <span aria-hidden="true">{signal.tier}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export interface ParsedDocumentCostLine {
  documentName: string;
  programs?: string;
  cost?: DocumentPreparationCostSignal;
}

export function parseDocumentCostLine(line: string): ParsedDocumentCostLine {
  const [documentPart, programs] = line.split(" — ", 2);
  // `\?` must be accepted alongside the dollar markers: report-engine writes
  // `[?]` for an undetermined document, and a parser that only knew `[$]`
  // would silently leave the marker sitting in the visible document name.
  const marker = documentPart.match(/^(.*?)\s+\[(\?|\${1,3})\]$/);
  if (!marker) return { documentName: documentPart, programs };

  const tier = marker[2] as DocumentPreparationCostTier;
  const basis = tier === "$$$"
    ? "Often requires specialized professional work."
    : tier === "$$"
      ? "May involve filing fees or professional help."
      : tier === "$"
        ? "Usually self-provided or low/no fee."
        : DOCUMENT_PREPARATION_COST_UNKNOWN_BASIS;

  return {
    documentName: marker[1],
    programs,
    cost: { tier, basis },
  };
}
