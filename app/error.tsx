"use client";

/**
 * Route-segment error boundary (R1 finding 2).
 *
 * Before this the repo had NO error.tsx, global-error.tsx, or ErrorBoundary
 * anywhere: an uncaught render error in any segment fell through to Next's
 * built-in screen — a stack trace in development, an unbranded "something
 * went wrong" in production, with no way back and no retry.
 *
 * Voice: the Warm Bureau register the app already uses for its honest
 * unavailable states (app/vacancy/[zip]/shortlist/page.tsx's UnavailableState,
 * app/permit-exhibit/[pin]/page.tsx's). Rules that apply here too:
 *   - Say what happened, in plain words. Never dress a failure as a finding.
 *   - Never blame the reader for a fault on our side.
 *   - Always leave a working way forward (retry, and a link out).
 * `reset()` re-renders the failed segment, so the retry is real: the same
 * work runs again rather than a reload that throws away the reader's place.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Visible to engineering; the reader gets the honest copy below, never
    // the message (it can carry internals and means nothing to them).
    console.error("[error boundary] unhandled render error:", error);
  }, [error]);

  return (
    <div className="min-h-[70vh] bg-[#FAF9F6] px-4 py-16 text-[#0C1B33] sm:px-8">
      <div className="mx-auto max-w-xl">
        <p className="font-mono-bureau text-[10px] uppercase tracking-[0.2em] text-[#0C1B33]/45">
          Something broke on our side
        </p>
        <h1 className="mt-3 font-editorial text-[38px] leading-[0.98] sm:text-[44px]">
          This page didn&rsquo;t load
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-[#0C1B33]/60">
          An error stopped this page part-way through. Nothing you did caused it, and nothing you
          entered was lost. Trying again often works — the page rebuilds from scratch.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono-bureau text-[11px] text-[#0C1B33]/35">
            Reference {error.digest}
          </p>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center bg-[#2563EB] px-4 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center border border-[#0C1B33]/20 bg-white px-4 py-3 text-[12px] font-semibold text-[#0C1B33]/70 transition-colors hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            Back to the start
          </Link>
        </div>
      </div>
    </div>
  );
}
