import { ExternalLink } from "lucide-react";

import type { Program } from "@/lib/types";
import type { ProgramAvailability } from "@/lib/program-gating";

export function ProgramCatalogActions({
  program,
  linkHealth,
  availability,
}: {
  program: Program;
  linkHealth: Map<string, "ok" | "broken">;
  availability?: ProgramAvailability;
}) {
  const canApply = availability?.state === "active";
  const submittablePortal = (program.applicationPortals || []).find(
    (portal) =>
      portal.type === "submittable" &&
      linkHealth.get(`${program.id}:${portal.url}`) !== "broken",
  );
  const otherLangPortals = (program.applicationPortals || []).filter(
    (portal) =>
      portal.type === "submittable" &&
      portal !== submittablePortal &&
      linkHealth.get(`${program.id}:${portal.url}`) !== "broken",
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApply && submittablePortal && (
        <a
          href={submittablePortal.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white bg-[#16a34a] hover:bg-[#15803d] inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase px-4 py-2 rounded-full transition-colors"
        >
          Apply via Submittable <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {canApply &&
        otherLangPortals.map((portal) => (
          <a
            key={portal.url}
            href={portal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#16a34a] border border-[#16a34a]/40 hover:bg-[#16a34a]/5 inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase px-3 py-2 rounded-full transition-colors"
          >
            {portal.language === "es" ? "Aplicar en español" : portal.label}
            <ExternalLink className="w-3 h-3" />
          </a>
        ))}
      <a
        href={program.sourceUrl || program.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#2563EB] border border-[#2563EB]/30 hover:bg-[#2563EB]/5 inline-flex items-center gap-1.5 font-mono-bureau text-[10px] tracking-[0.1em] uppercase px-4 py-2 rounded-full transition-colors"
      >
        {canApply ? "Official Source" : "Verify current status"}{" "}
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}
