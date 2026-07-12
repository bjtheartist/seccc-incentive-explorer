/**
 * Allowlisted client-side navigation targets the concierge may SUGGEST.
 * The model never navigates the user — it proposes a destination and the UI
 * renders a "Take me there →" button that the USER clicks (design note §1,
 * "client-side navigation actions, not just links in prose").
 */

/** Static routes the concierge can point to. */
export const CONCIERGE_STATIC_ROUTES = [
  "/map",
  "/report",
  "/faq",
  "/workspace",
  "/programs",
] as const;

export interface AllowedNavTarget {
  /** Resolved, safe path to navigate to. */
  route: string;
  /** Short human label for the confirmation button. */
  label: string;
}

/**
 * Validate a model-proposed navigation target against the allowlist. Returns
 * null if the route is not allowed. Program detail pages are allowed only in
 * the exact shape /programs/{slug} with a clean slug.
 */
export function resolveNavTarget(
  rawRoute: string,
  rawLabel?: string
): AllowedNavTarget | null {
  const route = (rawRoute || "").trim();
  if (!route.startsWith("/")) return null;
  // No protocol-relative, query smuggling, or fragments.
  if (route.includes("//") || route.includes("..")) return null;

  const [pathOnly] = route.split(/[?#]/);

  const label =
    (rawLabel || "").trim().slice(0, 60) || defaultLabelFor(pathOnly);

  if ((CONCIERGE_STATIC_ROUTES as readonly string[]).includes(pathOnly)) {
    return { route: pathOnly, label };
  }

  const programMatch = /^\/programs\/([a-z0-9-]+)$/.exec(pathOnly);
  if (programMatch) {
    return { route: pathOnly, label };
  }

  return null;
}

function defaultLabelFor(path: string): string {
  if (path === "/map") return "Open the map";
  if (path === "/report") return "Build a report";
  if (path === "/faq") return "Read the FAQ";
  if (path === "/workspace") return "Go to workspace";
  if (path === "/programs") return "Browse programs";
  if (path.startsWith("/programs/")) return "View this program";
  return "Take me there";
}
