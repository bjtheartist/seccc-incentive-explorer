"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics-events";

/**
 * Invisible client tracker — fires `owner_file_viewed` once on mount.
 * Mirrors components/analytics/SiteTrafficTracker.tsx's pattern (also a
 * `null`-rendering client component), used because the Owner File detail
 * page itself is a server component (force-dynamic) and SiteTrafficTracker
 * deliberately excludes `/admin` paths from generic `site_page_viewed`
 * tracking.
 */
export function OwnerFileViewTracker({
  zip,
  clusterKey,
  resolvedTier,
}: {
  zip: string;
  clusterKey: string;
  resolvedTier: string;
}) {
  useEffect(() => {
    trackEvent("owner_file_viewed", {
      source: "owner_file_detail",
      metadata: { zip, clusterKey, resolvedTier },
    });
    // Fire once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
