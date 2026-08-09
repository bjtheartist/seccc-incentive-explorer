import type {
  DocumentPreparationCostSignal,
  DocumentPreparationCostTier,
} from "@/lib/document-preparation-cost";

interface PreparationCostBadgeProps {
  signal: DocumentPreparationCostSignal;
  label?: string;
}

export function PreparationCostBadge({ signal, label = "Preparation" }: PreparationCostBadgeProps) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 border border-[#2563EB]/25 bg-[#2563EB]/[0.05] px-2 py-0.5 font-mono-bureau text-[8px] uppercase tracking-[0.1em] text-[#1D4ED8]"
      title={`${label}: ${signal.basis}`}
      aria-label={`${label} cost ${signal.tier}. ${signal.basis}`}
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
  const marker = documentPart.match(/^(.*?)\s+\[(\${1,3})\]$/);
  if (!marker) return { documentName: documentPart, programs };

  const tier = marker[2] as DocumentPreparationCostTier;
  const basis = tier === "$$$"
    ? "Often requires specialized professional work."
    : tier === "$$"
      ? "May involve filing fees or professional help."
      : "Usually self-provided or low/no fee.";

  return {
    documentName: marker[1],
    programs,
    cost: { tier, basis },
  };
}
