import type { ReactNode } from "react";

/**
 * Workspace layout. The persistent Incentive Guide is mounted by the root app
 * shell so it remains available while visitors move between workspace pages.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return children;
}
