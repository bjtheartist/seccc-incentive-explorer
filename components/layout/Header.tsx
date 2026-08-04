"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { ChevronDown, Menu, X } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Approved Set-A information architecture. Group and item labels are
 * client-approved copy — do not reword them.
 *
 * "Community Insights" intentionally carries exactly two entries: /neighborhoods
 * has no index page, so it is never linked from the global nav.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "eligibility",
    label: "Check Eligibility",
    items: [
      { href: "/check", label: "Quick Address Check" },
      { href: "/qualify", label: "Eligibility Survey" },
      { href: "/programs", label: "Program Directory" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    id: "site",
    label: "Find a Site",
    items: [
      { href: "/vacancy", label: "Vacant Sites" },
      { href: "/locate", label: "Site Matchmaker" },
      { href: "/map", label: "Incentive Map" },
    ],
  },
  {
    id: "data",
    label: "Community Insights",
    items: [
      { href: "/investment", label: "Community Investment" },
      { href: "/corridors", label: "Corridor Signals" },
    ],
  },
];

/** Pinned right, primary treatment. The home link is the logo. */
const PRIMARY_ITEM: NavItem = { href: "/report", label: "Generate Report" };

function matchesHref(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A group is highlighted when the route matches any of its member hrefs. */
function isGroupActive(pathname: string, group: NavGroup) {
  return group.items.some((item) => matchesHref(pathname, item.href));
}

function activeGroupId(pathname: string) {
  return NAV_GROUPS.find((group) => isGroupActive(pathname, group))?.id ?? null;
}

/**
 * Which group is expanded, and whether the pointer or an explicit click put it
 * there. A hover-opened panel closes on mouse-out; a click-opened one stays
 * until an outside click, Escape, or a route change.
 */
type OpenState = { id: string; via: "hover" | "click" } | null;

/* ── Desktop dropdown ─────────────────────────────────────────── */

function DesktopNavGroup({
  group,
  pathname,
  open,
  onToggle,
  onOpen,
  onClose,
  onHoverOpen,
  onHoverClose,
}: {
  group: NavGroup;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onClose: () => void;
  onHoverOpen: () => void;
  onHoverClose: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `nav-panel-${group.id}`;
  const triggerId = `nav-trigger-${group.id}`;
  const active = isGroupActive(pathname, group);

  /** Focus the nth link in the panel; negative indexes wrap from the end. */
  const focusItem = (index: number) => {
    const links = Array.from(
      panelRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-nav-item]") ?? []
    );
    if (links.length === 0) return;
    links[((index % links.length) + links.length) % links.length]?.focus();
  };

  /** The panel has to be visible before it can take focus, so defer a tick. */
  const openThenFocus = (index: number) => {
    onOpen();
    window.setTimeout(() => focusItem(index), 0);
  };

  const tone = active
    ? "text-[#2563EB] ring-2 ring-[#2563EB]/30 ring-offset-1"
    : open
      ? "text-[#0C1B33]/80"
      : "text-[#0C1B33]/40 hover:text-[#0C1B33]/80";

  return (
    <div
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") onHoverOpen();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onHoverClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          onClose();
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openThenFocus(0);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openThenFocus(-1);
          }
        }}
        className={`inline-flex items-center gap-1.5 px-3.5 py-2 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors cursor-pointer ${tone}`}
      >
        {group.label}
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {/* The pt-3 strip is a transparent bridge so the pointer can travel from
          the trigger to the panel without crossing a dead gap. */}
      <div
        ref={panelRef}
        className={`absolute left-0 top-full z-50 pt-3 transition-[opacity,transform] duration-150 ${
          open ? "visible opacity-100 translate-y-0" : "invisible opacity-0 -translate-y-1"
        }`}
      >
        <div
          id={panelId}
          role="menu"
          aria-labelledby={triggerId}
          className="min-w-[248px] border border-[#0C1B33]/10 bg-white shadow-[0_20px_44px_-26px_rgba(12,27,51,0.55)]"
        >
          {group.items.map((item, i) => {
            const itemActive = matchesHref(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                data-nav-item
                aria-current={itemActive ? "page" : undefined}
                onClick={onClose}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    focusItem(i + 1);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    focusItem(i - 1);
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    focusItem(0);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    focusItem(-1);
                  } else if (e.key === "Tab") {
                    onClose();
                  }
                }}
                className={`block px-4 py-3 border-b border-[#0C1B33]/5 last:border-b-0 font-mono-bureau text-[10px] tracking-[0.18em] uppercase transition-colors ${
                  itemActive
                    ? "text-[#2563EB] bg-[#EFF3FB]"
                    : "text-[#0C1B33]/70 hover:text-[#0C1B33] hover:bg-[#EFF3FB]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Mobile accordion section ─────────────────────────────────── */

function MobileNavGroup({
  group,
  index,
  pathname,
  expanded,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  index: number;
  pathname: string;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const panelId = `mobile-nav-panel-${group.id}`;
  const active = isGroupActive(pathname, group);

  return (
    <div className="border-b border-[#0C1B33]/5">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={`w-full py-4 font-mono-bureau text-[11px] tracking-[0.2em] uppercase flex items-center gap-4 text-left cursor-pointer ${
          active ? "text-[#2563EB]" : "text-[#0C1B33]/60"
        }`}
      >
        <span aria-hidden="true" className="text-[#0C1B33]/15 text-[10px]">0{index + 1}</span>
        <span className="flex-1">{group.label}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!expanded} className="pb-3 pl-8">
        {group.items.map((item) => {
          const itemActive = matchesHref(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={itemActive ? "page" : undefined}
              className={`block py-2.5 font-mono-bureau text-[10px] tracking-[0.18em] uppercase ${
                itemActive ? "text-[#2563EB]" : "text-[#0C1B33]/40 hover:text-[#0C1B33]/80"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── Header ───────────────────────────────────────────────────── */

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openState, setOpenState] = useState<OpenState>(null);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const { status } = useSession();
  const signedIn = status === "authenticated";

  // Outside click and Escape dismiss whichever desktop panel is open.
  useEffect(() => {
    if (!openState) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenState(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenState(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openState]);

  // A completed navigation should never leave a panel hanging open. Derived
  // during render rather than in an effect, so the new route never paints with
  // the old menu still down.
  const [renderedPath, setRenderedPath] = useState(pathname);
  if (renderedPath !== pathname) {
    setRenderedPath(pathname);
    if (openState) setOpenState(null);
  }

  const primaryActive = matchesHref(pathname, PRIMARY_ITEM.href);

  return (
    <header className="sticky top-0 z-50 border-b border-[#0C1B33]/10 bg-white/95 backdrop-blur-md">
      <div className="container mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50 border border-[#0C1B33]/20 px-2 py-1 group-hover:text-[#2563EB] group-hover:border-[#2563EB]/40 transition-colors">
            CSIM
          </div>
          <div className="hidden sm:block">
            <div className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-[#0C1B33]/80">
              Chicago Incentive Explorer
            </div>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav ref={navRef} aria-label="Primary" className="hidden md:flex items-center gap-1">
          {NAV_GROUPS.map((group) => (
            <DesktopNavGroup
              key={group.id}
              group={group}
              pathname={pathname}
              open={openState?.id === group.id}
              onToggle={() =>
                setOpenState((prev) =>
                  prev?.id === group.id && prev.via === "click"
                    ? null
                    : { id: group.id, via: "click" }
                )
              }
              onOpen={() => setOpenState({ id: group.id, via: "click" })}
              onClose={() => setOpenState(null)}
              onHoverOpen={() =>
                setOpenState((prev) =>
                  prev?.id === group.id ? prev : { id: group.id, via: prev?.via ?? "hover" }
                )
              }
              onHoverClose={() =>
                setOpenState((prev) =>
                  prev?.id === group.id && prev.via === "hover" ? null : prev
                )
              }
            />
          ))}

          {signedIn && (
            <Link
              href="/workspace"
              className={`px-3.5 py-2 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors ${
                matchesHref(pathname, "/workspace")
                  ? "text-[#2563EB] ring-2 ring-[#2563EB]/30 ring-offset-1"
                  : "text-[#0C1B33]/40 hover:text-[#0C1B33]/80"
              }`}
            >
              Workspace
            </Link>
          )}
          {signedIn && (
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="px-3.5 py-2 font-mono-bureau text-[10px] tracking-[0.2em] uppercase text-[#0C1B33]/35 hover:text-[#0C1B33]/70 transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          )}

          <Link
            href={PRIMARY_ITEM.href}
            className={`ml-2 px-4 py-1.5 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors bg-[#2563EB] text-white hover:bg-[#1d4ed8] ${
              primaryActive ? "ring-2 ring-[#2563EB]/30 ring-offset-1" : ""
            }`}
          >
            {PRIMARY_ITEM.label}
          </Link>
        </nav>

        {/* Mobile Nav */}
        <Sheet
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setMobileGroup(activeGroupId(pathname));
          }}
        >
          <SheetTrigger asChild className="md:hidden">
            <button aria-label="Open menu" className="text-[#0C1B33]/60 hover:text-[#0C1B33] p-2">
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-72 bg-white border-l border-[#0C1B33]/10 overflow-y-auto px-6 py-5"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex items-center justify-between mb-6">
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40">
                Menu
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="text-[#0C1B33]/40 hover:text-[#0C1B33]"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Primary" className="flex flex-col gap-0">
              {NAV_GROUPS.map((group, i) => (
                <MobileNavGroup
                  key={group.id}
                  group={group}
                  index={i}
                  pathname={pathname}
                  expanded={mobileGroup === group.id}
                  onToggle={() =>
                    setMobileGroup((prev) => (prev === group.id ? null : group.id))
                  }
                  onNavigate={() => setOpen(false)}
                />
              ))}

              <Link
                href={PRIMARY_ITEM.href}
                onClick={() => setOpen(false)}
                className={`mt-6 px-4 py-3 text-center font-mono-bureau text-[11px] tracking-[0.2em] uppercase bg-[#2563EB] text-white hover:bg-[#1d4ed8] transition-colors ${
                  primaryActive ? "ring-2 ring-[#2563EB]/30 ring-offset-1" : ""
                }`}
              >
                {PRIMARY_ITEM.label}
              </Link>

              {signedIn && (
                <Link
                  href="/workspace"
                  onClick={() => setOpen(false)}
                  className={`mt-4 py-4 border-t border-[#0C1B33]/5 font-mono-bureau text-[11px] tracking-[0.2em] uppercase ${
                    matchesHref(pathname, "/workspace")
                      ? "text-[#2563EB]"
                      : "text-[#0C1B33]/40 hover:text-[#0C1B33]/80"
                  }`}
                >
                  Workspace
                </Link>
              )}
              {signedIn && (
                <button
                  onClick={() => {
                    setOpen(false);
                    signOut({ callbackUrl: "/" });
                  }}
                  className="py-4 border-t border-[#0C1B33]/5 font-mono-bureau text-[11px] tracking-[0.2em] uppercase text-left text-[#0C1B33]/40 hover:text-[#0C1B33]/80"
                >
                  Sign Out
                </button>
              )}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
