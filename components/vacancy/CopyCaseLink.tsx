"use client";

/**
 * Copy-case-link button — the ONE client island on the Case Workbench. The
 * page is otherwise server-rendered: the active case lives in the `?case=`
 * search param, so a shared link restores the exact case without any client
 * state. This button just copies the current URL (with `?case=` forced to the
 * active case) to the clipboard, with a brief confirmation.
 *
 * It reads `window.location` at click time rather than being handed a URL, so
 * the copied link always reflects the real origin (localhost, preview, prod)
 * the visitor is on.
 */

import { useCallback, useState } from "react";
import type { CaseKey } from "@/lib/vacancy-cases";

export function CopyCaseLink({ caseKey }: { caseKey: CaseKey }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("case", caseKey);
    const href = url.toString();
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (permissions/insecure context) — select-fallback:
      // surface the link so the visitor can copy it by hand rather than
      // silently failing.
      window.prompt("Copy this case link", href);
    }
  }, [caseKey]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-live="polite"
      className="inline-flex items-center gap-2 border border-[#0C1B33]/25 bg-white px-3 py-1.5 font-mono-bureau text-[10px] uppercase tracking-[0.12em] text-[#0C1B33]/70 transition-colors hover:border-[#2563EB]/50 hover:text-[#2563EB]"
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${copied ? "bg-[#059669]" : "bg-[#2563EB]"}`}
      />
      {copied ? "Case link copied" : "Copy case link"}
    </button>
  );
}
