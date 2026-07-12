import type { ReactNode } from "react";
import { WorkspaceConciergeMount } from "@/components/concierge/WorkspaceConciergeMount";

/**
 * Workspace layout — renders the read-only guest concierge on every workspace
 * page (design note: report + workspace, not site-wide). The panel is
 * feature-flagged and renders nothing when the concierge is disabled.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <WorkspaceConciergeMount />
    </>
  );
}
