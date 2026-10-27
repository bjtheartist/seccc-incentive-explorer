"use client";

import { Analytics } from "@vercel/analytics/next";
import { analyticsAllowed } from "@/lib/analytics-consent";

/** Vercel Analytics, suppressed for visitors who turned analytics off. */
export function ConsentAwareAnalytics() {
  return <Analytics beforeSend={(event) => (analyticsAllowed() ? event : null)} />;
}
