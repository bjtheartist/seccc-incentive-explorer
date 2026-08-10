import { FileText } from "lucide-react";
import { isDocumentRequirementGuidance } from "@/lib/document-preparation-cost";
import type { Program } from "@/lib/types";

export function ProgramDocumentRequirements({
  requiredDocs,
}: {
  requiredDocs: Program["requiredDocs"];
}) {
  const documents = requiredDocs.filter(
    (item) => !isDocumentRequirementGuidance(item),
  );
  const guidance = requiredDocs.filter(isDocumentRequirementGuidance);

  if (documents.length === 0 && guidance.length === 0) return null;

  return (
    <>
      {documents.length > 0 && (
        <div>
          <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-3 flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Required Documents
          </h3>
          <ul className="text-sm space-y-2 text-[#0C1B33]/60">
            {documents.map((doc, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="w-5 h-5 rounded border border-[#0C1B33]/15 shrink-0" />
                {doc}
              </li>
            ))}
          </ul>
        </div>
      )}

      {guidance.length > 0 && (
        <div>
          <h3 className="font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-[#0C1B33]/35 mb-3">
            Document notes
          </h3>
          <ul className="text-sm space-y-2 text-[#0C1B33]/60">
            {guidance.map((note, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#0C1B33]/20 shrink-0" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
