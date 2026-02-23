"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

interface NavItem {
  href: string;
  label: string;
  isPrimary?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/report", label: "Generate Report", isPrimary: true },
  { href: "/map", label: "Explorer" },
  { href: "/programs", label: "Programs" },
  { href: "/faq", label: "FAQ" },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#0C1B33]/10 bg-white/95 backdrop-blur-md">
      <div className="container mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/50 border border-[#0C1B33]/20 px-2 py-1 group-hover:text-[#2563EB] group-hover:border-[#2563EB]/40 transition-colors">
            CHI
          </div>
          <div className="hidden sm:block">
            <div className="font-mono-bureau text-[11px] tracking-[0.15em] uppercase text-[#0C1B33]/80">
              Chicago Incentive Explorer
            </div>
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) =>
            item.isPrimary ? (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-1.5 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors bg-[#2563EB] text-white hover:bg-[#1d4ed8] ${
                  pathname === item.href ? "ring-2 ring-[#2563EB]/30 ring-offset-1" : ""
                }`}
              >
                {item.label}
              </Link>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 font-mono-bureau text-[10px] tracking-[0.2em] uppercase transition-colors border-b-2 ${
                  pathname === item.href
                    ? "text-[#2563EB] border-[#2563EB]"
                    : "text-[#0C1B33]/40 border-transparent hover:text-[#0C1B33]/80"
                }`}
              >
                {item.label}
              </Link>
            )
          )}
        </nav>

        {/* Mobile Nav */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="md:hidden">
            <button className="text-[#0C1B33]/60 hover:text-[#0C1B33] p-2">
              <Menu className="w-5 h-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-64 bg-white border-l border-[#0C1B33]/10">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex items-center justify-between mb-12">
              <span className="font-mono-bureau text-[10px] tracking-[0.3em] uppercase text-[#0C1B33]/40">
                Menu
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-[#0C1B33]/40 hover:text-[#0C1B33]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-0">
              {NAV_ITEMS.map((item, i) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`py-4 border-b border-[#0C1B33]/5 font-mono-bureau text-[11px] tracking-[0.2em] uppercase flex items-center gap-4 ${
                    item.isPrimary
                      ? "text-[#2563EB] font-medium"
                      : pathname === item.href
                        ? "text-[#2563EB]"
                        : "text-[#0C1B33]/40 hover:text-[#0C1B33]/80"
                  }`}
                >
                  <span className="text-[#0C1B33]/15 text-[10px]">0{i + 1}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
