/**
 * Allowlisted client-side navigation targets the concierge may SUGGEST.
 * The model never navigates the user — it proposes a destination and the UI
 * renders a "Take me there →" button that the USER clicks (design note §1,
 * "client-side navigation actions, not just links in prose").
 */
import { getProgramBySlug } from "@/lib/programs-data";

/** Static routes the concierge can point to. */
export const CONCIERGE_STATIC_ROUTES = [
  "/map",
  "/report",
  "/faq",
  "/workspace",
  "/workspace/business-file",
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
 * null if the route is not allowed. Program detail pages are allowed only when
 * the slug resolves to a real program in the Explorer dataset.
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
  if (programMatch && getProgramBySlug(programMatch[1])) {
    return { route: pathOnly, label };
  }

  // Signed-in workspace deep-links the action tools point to. The packet id is a
  // uuid-style string (gen_random_uuid()::text). Kept strict to clean id chars.
  if (pathOnly === "/workspace/incentive-preparation/new") {
    return { route: pathOnly, label };
  }
  const packetMatch = /^\/workspace\/incentive-preparation\/([a-z0-9-]+)$/.exec(pathOnly);
  if (packetMatch) {
    return { route: pathOnly, label };
  }
  const profileMatch =
    /^\/workspace\/business-file\/([a-z0-9-]+)\/edit$/.exec(pathOnly);
  if (profileMatch) {
    return { route: pathOnly, label };
  }

  return null;
}

function defaultLabelFor(path: string): string {
  if (path === "/map") return "Open the map";
  if (path === "/report") return "Build a report";
  if (path === "/faq") return "Read the FAQ";
  if (path === "/workspace") return "Go to workspace";
  if (path === "/workspace/business-file") return "Open your Business File";
  if (path === "/programs") return "Browse programs";
  if (path.startsWith("/programs/")) return "View this program";
  return "Take me there";
}
