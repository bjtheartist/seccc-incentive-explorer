"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/analytics-events";
import { readTrafficAttribution } from "@/lib/traffic-attribution";

const SESSION_KEY = "cie_traffic_session_id";
const SESSION_STARTED_KEY = "cie_traffic_session_started_at";

interface TrafficObservation {
  pathname: string;
  campaign: string | null;
}

export function explicitCampaignAttribution(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const key of ["campaign", "utm_campaign", "c"]) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

export function shouldTrackSitePageView(
  previous: TrafficObservation | null,
  next: TrafficObservation,
): boolean {
  if (!previous || previous.pathname !== next.pathname) return true;
  return next.campaign !== null && next.campaign !== previous.campaign;
}

function getSessionId() {
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    window.localStorage.setItem(SESSION_KEY, id);
    window.localStorage.setItem(SESSION_STARTED_KEY, new Date().toISOString());
    return id;
  } catch {
    return "storage-unavailable";
  }
}

function pageLabel(pathname: string) {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/start")) return "Start Page";
  if (pathname.startsWith("/check")) return "Quick Address Check";
  if (pathname.startsWith("/map")) return "Explorer Map";
  if (pathname.startsWith("/report")) return "Report Flow";
  if (pathname.startsWith("/programs")) return "Programs";
  if (pathname.startsWith("/locate")) return "Vacancy Analysis";
  if (pathname.startsWith("/faq")) return "FAQ";
  if (pathname.startsWith("/workspace")) return "Workspace";
  return pathname;
}

function deviceType() {
  const width = window.innerWidth;
  const ua = window.navigator.userAgent.toLowerCase();

  if (/ipad|tablet/.test(ua) || (width >= 768 && width < 1024)) return "tablet";
  if (/mobi|iphone|android/.test(ua) || width < 768) return "mobile";
  if (width >= 1024) return "desktop";
  return "unknown";
}

export function SiteTrafficTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const latestSearch = useRef(search);
  const previousObservation = useRef<TrafficObservation | null>(null);
  const campaign = explicitCampaignAttribution(search);

  useEffect(() => {
    latestSearch.current = search;
  }, [search]);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    const observation = { pathname, campaign };
    const shouldTrack = shouldTrackSitePageView(
      previousObservation.current,
      observation,
    );
    previousObservation.current = observation;
    if (!shouldTrack) return;

    const currentSearch = latestSearch.current;
    const searchQuery = currentSearch ? `?${currentSearch}` : "";

    trackEvent("site_page_viewed", {
      source: "site_traffic",
      metadata: {
        path: pathname,
        page: pageLabel(pathname),
        sessionId: getSessionId(),
        deviceType: deviceType(),
        viewportWidth: window.innerWidth,
        ...readTrafficAttribution(searchQuery, document.referrer),
      },
    });
  }, [pathname, campaign]);

  return null;
}
