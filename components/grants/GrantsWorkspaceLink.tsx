"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
export function GrantsWorkspaceLink() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/grants/access", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (r.ok) setAllowed(true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!allowed) return null;
  return (
    <Link
      href="/admin/grants"
      className="mb-7 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900"
    >
      <ShieldCheck size={18} />
      <span className="flex-1">
        <strong>Team Grants Matchmaker</strong>
        <span className="ml-3 text-xs text-emerald-700">
          Sources, opportunities and business matches
        </span>
      </span>
      <ArrowRight size={17} />
    </Link>
  );
}
