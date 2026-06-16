"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics-events";

const SESSION_KEY = "cie_traffic_session_id";
const SESSION_STARTED_KEY = "cie_traffic_session_started_at";

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

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;

    trackEvent("site_page_viewed", {
      source: "site_traffic",
      metadata: {
        path: pathname,
        page: pageLabel(pathname),
        sessionId: getSessionId(),
        deviceType: deviceType(),
        viewportWidth: window.innerWidth,
      },
    });
  }, [pathname]);

  return null;
}
