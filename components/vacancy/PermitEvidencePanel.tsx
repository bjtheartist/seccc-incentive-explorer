"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";
import {
  cachedPermitMatch,
  fetchPermitMatch,
  type PermitMatchState,
} from "@/lib/permit-match-client";
import {
  PERMIT_DATA_SOURCE_TEXT,
  PERMIT_MATCH_ERROR_TEXT,
  PERMIT_NO_MATCH_TEXT,
  PERMIT_PORTAL_LABEL,
  PERMIT_PORTAL_URL,
  PERMIT_VERIFICATION_NOTE,
  permitDetailLines,
  permitMatchWarning,
} from "@/lib/permit-match-lines";

const IDLE: PermitMatchState = { status: "idle" };

export function PermitEvidencePanel({ pin }: { pin: string | null }) {
  const [result, setResult] = useState<{ pin: string; state: PermitMatchState } | null>(null);
  const cached = pin ? cachedPermitMatch(pin) : null;
  const state: PermitMatchState = !pin
    ? IDLE
    : cached ?? (result?.pin === pin ? result.state : { status: "loading" });

  useEffect(() => {
    if (!pin || cachedPermitMatch(pin)) return;

    const controller = new AbortController();
    let active = true;
    void fetchPermitMatch(pin, controller.signal).then((next) => {
      if (active) setResult({ pin, state: next });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [pin]);

  return (
    <section aria-labelledby="permit-evidence-title" className="border-t border-[#0C1B33]/10 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id="permit-evidence-title" className="text-[13px] font-semibold text-[#0C1B33]">
            Matched building permit records
          </h4>
          <p className="mt-1 font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/40">
            {PERMIT_DATA_SOURCE_TEXT}
          </p>
        </div>
        <a
          href={PERMIT_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:underline"
        >
          {PERMIT_PORTAL_LABEL}
          <ExternalLink aria-hidden="true" size={12} />
        </a>
      </div>

      {!pin ? (
        <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/50">
          No parcel PIN is attached to this record, so an automatic permit match cannot be checked.
        </p>
      ) : state.status === "loading" || state.status === "idle" ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-[#0C1B33]/50">
          <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
          Checking matched permit records
        </p>
      ) : state.status === "error" ? (
        <p className="mt-3 text-[12px] leading-relaxed text-[#A45B00]">{PERMIT_MATCH_ERROR_TEXT}</p>
      ) : state.matches.length === 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-[#0C1B33]/50">{PERMIT_NO_MATCH_TEXT}</p>
      ) : (
        <>
          <div className="mt-3 divide-y divide-[#0C1B33]/10 border-y border-[#0C1B33]/10">
            {state.matches.slice(0, 3).map((permit) => (
              <div key={permit.permitId} className="py-4">
                {permit.workDescription ? (
                  <p className="mb-3 max-w-3xl text-[12px] leading-relaxed text-[#0C1B33]/70">
                    {permit.workDescription}
                  </p>
                ) : null}
                <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {permitDetailLines(permit).map((line) => (
                    <div key={line.label} className="min-w-0">
                      <dt className="font-mono-bureau text-[9px] uppercase tracking-[0.09em] text-[#0C1B33]/40">
                        {line.label}
                      </dt>
                      <dd className="mt-0.5 break-words text-[11px] leading-snug text-[#0C1B33]/75">
                        {line.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {permitMatchWarning(permit) ? (
                  <p className="mt-3 border border-[#A45B00]/20 bg-[#FFF8E8] px-3 py-2 text-[11px] leading-relaxed text-[#7A4300]">
                    {permitMatchWarning(permit)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          {state.matches.length > 3 ? (
            <p className="mt-2 text-[10px] text-[#0C1B33]/45">
              Showing the three most recent of {state.matches.length.toLocaleString("en-US")} matched records.
            </p>
          ) : null}
          <p className="mt-3 text-[11px] leading-relaxed text-[#0C1B33]/45">
            {PERMIT_VERIFICATION_NOTE}
          </p>
        </>
      )}
    </section>
  );
}
