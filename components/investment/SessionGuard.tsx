"use client";

import { useEffect } from "react";
import { clearInvestmentWorkingSet } from "./local-store";

/**
 * Shared-machine hygiene guard. On any /investment surface that renders it, probe
 * the admin session once (the same /api/owner-file/session probe the map legend
 * uses). If it is NOT active — the httpOnly admin cookie lapsed (8h) or was
 * cleared — wipe the working-set storage (saved named records + private meeting
 * notes, pinned compare areas, and the session filters) so the next person on the
 * machine cannot recover a departed admin's shortlist via DevTools or a fresh
 * login. A 204 means the session is live → the working set is left intact. A
 * network/abort error is inconclusive and never triggers a wipe.
 *
 * Rendered on the login wall (the surface a lapsed admin lands on when they return),
 * so the stale working set is purged before anyone re-authenticates. Renders nothing.
 */
export function InvestmentSessionGuard() {
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/owner-file/session", { signal: controller.signal })
      .then((res) => {
        if (res.status !== 204) clearInvestmentWorkingSet();
      })
      .catch(() => {
        /* inconclusive probe (network / abort) — never wipe on uncertainty */
      });
    return () => controller.abort();
  }, []);
  return null;
}
