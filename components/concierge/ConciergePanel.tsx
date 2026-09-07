"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import type { ConciergePageContext } from "@/lib/concierge/types";
import { ConciergeLauncher } from "./ConciergeLauncher";

const ConciergeConversation = dynamic(
  () => import("./ConciergeConversation").then((module) => module.ConciergeConversation),
  { loading: () => (
    <div role="status" className="fixed bottom-4 right-4 z-[70] flex items-center gap-2 border border-[#0C1B33]/15 bg-white px-4 py-3 text-sm text-[#0C1B33] shadow-lg">
      <Loader2 className="h-4 w-4 animate-spin" /> Opening Incentive Guide…
    </div>
  ) },
);

/** Keep the AI SDK and transcript UI off every page's initial download. */
export function ConciergePanel({
  pageContext,
  suppressed = false,
}: {
  pageContext: ConciergePageContext;
  suppressed?: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [activated, setActivated] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/concierge/status", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { enabled: false })
      .then((data) => { if (!controller.signal.aborted) setEnabled(Boolean(data?.enabled)); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (activated || !enabled) return;
    const check = () => setDialogOpen(Boolean(document.querySelector(
      'dialog[open], [role="dialog"], [aria-modal="true"]',
    )));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["open", "role", "aria-modal"],
    });
    return () => observer.disconnect();
  }, [activated, enabled]);

  if (!enabled) return null;
  // Once opened, keep the same instance and transcript alive across routes.
  if (activated) return <ConciergeConversation pageContext={pageContext} suppressed={suppressed} />;
  if (suppressed || dialogOpen) return null;
  const openPanel = () => {
    trackEvent("concierge_opened", { source: pageContext.route });
    setActivated(true);
  };

  return (
    <ConciergeLauncher openPanel={openPanel} />
  );
}
