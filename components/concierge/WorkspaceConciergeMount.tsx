"use client";

import { usePathname } from "next/navigation";
import { ConciergePanel } from "./ConciergePanel";

/**
 * Mounts the read-only concierge across every /workspace route. Route-only
 * context (no report summary here); the panel still renders nothing unless the
 * feature is enabled server-side.
 */
export function WorkspaceConciergeMount() {
  const pathname = usePathname() || "/workspace";
  return (
    <ConciergePanel
      pageContext={{ route: pathname, pageLabel: "Workspace" }}
    />
  );
}
