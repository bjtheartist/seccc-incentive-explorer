"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics-events";

/**
 * Fires `start_page_viewed` once on mount for the focused /start landing page.
 * Reads source/campaign from the query string (e.g. /start?source=qr&c=lisc)
 * so presentation, QR, LinkedIn, and partner traffic can be told apart.
 * Uses window.location (not useSearchParams) to avoid a Suspense boundary.
 */
export function StartPageTracker() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const source =
      params.get("source") || params.get("utm_source") || "start";
    const campaign = params.get("utm_campaign") || params.get("c");
    trackEvent("start_page_viewed", {
      source,
      metadata: { campaign },
    });
  }, []);

  return null;
}
