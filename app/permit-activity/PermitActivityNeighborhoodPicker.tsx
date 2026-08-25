"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

interface PermitActivityNeighborhoodOption {
  name: string;
  slug: string;
}

export function PermitActivityNeighborhoodPicker({
  neighborhoods,
}: {
  neighborhoods: PermitActivityNeighborhoodOption[];
}) {
  const router = useRouter();
  const [selectedSlug, setSelectedSlug] = useState("");

  function openAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlug) return;
    router.push(`/permit-activity/${selectedSlug}`);
  }

  return (
    <form onSubmit={openAnalysis}>
      <label htmlFor="permit-activity-neighborhood" className="block">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]/55">
          Neighborhood
        </span>
        <span className="relative mt-2 block">
          <select
            id="permit-activity-neighborhood"
            name="neighborhood"
            required
            value={selectedSlug}
            onChange={(event) => setSelectedSlug(event.target.value)}
            className="h-14 w-full appearance-none border border-[#0C1B33]/15 bg-white px-4 pr-12 text-[14px] text-[#0C1B33] outline-none transition-colors focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10"
          >
            <option value="">Select a neighborhood</option>
            {neighborhoods.map((neighborhood) => (
              <option key={neighborhood.slug} value={neighborhood.slug}>
                {neighborhood.name}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#0C1B33]/35"
          >
            ▾
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={!selectedSlug}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 bg-[#0C1B33] px-6 font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-[#0C1B33]/10 disabled:text-[#0C1B33]/28"
      >
        View permit activity
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
