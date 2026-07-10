import type { ProjectFitSummary } from "@/lib/project-fit";

interface ProjectFitNoteProps {
  fit?: ProjectFitSummary;
}

export function ProjectFitNote({ fit }: ProjectFitNoteProps) {
  if (!fit || fit.level === "location-only") return null;

  const labelColor = fit.level === "industry-check"
    ? "text-amber-700"
    : "text-[#2563EB]";

  return (
    <p className="mt-2 text-[11px] leading-relaxed text-[#0C1B33]/55 sm:text-[12px]">
      <span className={`font-semibold ${labelColor}`}>{fit.label}.</span>{" "}
      {fit.reason}
    </p>
  );
}
