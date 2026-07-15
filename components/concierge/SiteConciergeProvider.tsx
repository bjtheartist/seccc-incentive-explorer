"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
import type { ConciergePageContext } from "@/lib/concierge/types";
import { ConciergePanel } from "./ConciergePanel";

interface ConciergeOverride {
  owner: symbol;
  pageContext: ConciergePageContext;
  suppressed: boolean;
}

type SetConciergeOverride = Dispatch<SetStateAction<ConciergeOverride | null>>;

const ConciergeOverrideContext = createContext<SetConciergeOverride | null>(
  null
);

export function pageLabelForRoute(route: string): string {
  if (route === "/") return "Home";
  if (route.startsWith("/report")) return "Incentive report";
  if (route.startsWith("/workspace")) return "Workspace";
  if (route.startsWith("/programs/")) return "Program details";
  if (route === "/programs") return "Program library";
  if (route.startsWith("/map")) return "Incentive map";
  if (route.startsWith("/locate")) return "Location explorer";
  if (route.startsWith("/corridors")) return "Corridor intelligence";
  if (route.startsWith("/neighborhoods")) return "Neighborhood incentives";
  if (route.startsWith("/qualify")) return "Pre-qualification";
  if (route.startsWith("/quiz")) return "Incentive quiz";
  if (route.startsWith("/faq")) return "Frequently asked questions";
  if (route.startsWith("/answers")) return "Incentive answers";
  if (route.startsWith("/check")) return "Address check";
  if (route.startsWith("/login")) return "Sign in";
  if (route.startsWith("/forgot-password")) return "Password recovery";
  if (route.startsWith("/reset-password")) return "Reset password";
  if (route.startsWith("/admin")) return "Administration";
  return "Chicago Incentive Explorer";
}

/**
 * Keeps one guide instance alive across the entire app so the launcher and
 * conversation remain available while visitors move between routes.
 */
export function SiteConciergeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [override, setOverride] = useState<ConciergeOverride | null>(null);
  const fallbackContext = useMemo<ConciergePageContext>(
    () => ({ route: pathname, pageLabel: pageLabelForRoute(pathname) }),
    [pathname]
  );
  const activeOverride =
    override?.pageContext.route === pathname ? override : null;

  return (
    <ConciergeOverrideContext.Provider value={setOverride}>
      {children}
      <ConciergePanel
        pageContext={activeOverride?.pageContext ?? fallbackContext}
        suppressed={activeOverride?.suppressed ?? false}
      />
    </ConciergeOverrideContext.Provider>
  );
}

/**
 * Lets a page add richer, non-sensitive context to the persistent site guide.
 * The report uses this for the active address and summary while preserving the
 * same panel instance mounted by SiteConciergeProvider.
 */
export function ConciergePageContextBridge({
  route,
  pageLabel,
  reportSummary,
  address,
  lat,
  lon,
  visiblePrograms,
  localSupportOrganizations,
  capitalSupportName,
  capitalSupportReason,
  capitalSupportFitNote,
  capitalSupportIntakeUrl,
  suppressed = false,
}: ConciergePageContext & { suppressed?: boolean }) {
  const setOverride = useContext(ConciergeOverrideContext);
  const ownerRef = useRef(Symbol("concierge-page-context"));
  const serializedLocalSupport = localSupportOrganizations
    ? JSON.stringify(localSupportOrganizations)
    : "";
  const stableLocalSupportOrganizations = useMemo<
    ConciergePageContext["localSupportOrganizations"]
  >(
    () =>
      serializedLocalSupport
        ? (JSON.parse(serializedLocalSupport) as ConciergePageContext["localSupportOrganizations"])
        : undefined,
    [serializedLocalSupport]
  );

  useEffect(() => {
    if (!setOverride) return;
    const owner = ownerRef.current;
    setOverride({
      owner,
      pageContext: {
        route,
        pageLabel,
        reportSummary,
        address,
        lat,
        lon,
        visiblePrograms,
        localSupportOrganizations: stableLocalSupportOrganizations,
        capitalSupportName,
        capitalSupportReason,
        capitalSupportFitNote,
        capitalSupportIntakeUrl,
      },
      suppressed,
    });

    return () => {
      setOverride((current) => (current?.owner === owner ? null : current));
    };
  }, [
    address,
    lat,
    lon,
    capitalSupportFitNote,
    capitalSupportIntakeUrl,
    capitalSupportName,
    capitalSupportReason,
    pageLabel,
    reportSummary,
    route,
    setOverride,
    stableLocalSupportOrganizations,
    suppressed,
    visiblePrograms,
  ]);

  return null;
}
