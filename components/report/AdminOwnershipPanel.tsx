"use client";

// ─── Admin Ownership Panel ───────────────────────────────────────────
// Screen-only admin ownership context for a single address report
// (app/report/page.tsx's ReportDisplay). Fed by /api/owner-file/geo, which
// is gated behind the Owner Files admin session — this panel only ever
// mounts once the parent has confirmed a valid session via
// /api/owner-file/session.
//
// Product boundary: this data must NEVER reach the PDF download or emailed
// report. Those pipelines build exclusively from the canonical
// GeneratedReport object (lib/pdf-report.ts generateReportPdf /
// generateReportPdfBase64 take only `report`); this component's props are
// never merged into it. See
// lib/__tests__/pdf-report-admin-ownership-exclusion.test.ts.

import { Lock } from "lucide-react";
import Link from "next/link";
import { OWNER_TYPE_LABELS, type OwnerType } from "@/lib/owner-classify";
import type { OwnerFileReportMatch, OwnerFileReportTopCluster } from "@/lib/owner-file-report-context";

export type AdminOwnershipPanelStatus = "idle" | "loading" | "ready" | "error";

const CONFIDENCE_BADGE: Record<string, string> = {
  High: "bg-[#DCFCE7] text-[#16A34A]",
  Medium: "bg-[#FEF3C7] text-[#D97706]",
  Low: "bg-[#0C1B33]/5 text-[#0C1B33]/45",
};

function ownerTypeLabel(ownerType: string | null): string {
  if (!ownerType) return OWNER_TYPE_LABELS.unknown;
  return OWNER_TYPE_LABELS[ownerType as OwnerType] ?? OWNER_TYPE_LABELS.unknown;
}

function AdminBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[#D97706]/10 px-2 py-1 font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#B45309]">
      <Lock className="h-3 w-3" aria-hidden="true" />
      Admin Only
    </span>
  );
}

function ClusterRow({
  cluster,
  ownerFileHref,
}: {
  cluster: OwnerFileReportMatch | OwnerFileReportTopCluster;
  ownerFileHref: string;
}) {
  return (
    <div className="flex flex-col gap-2 border border-[#0C1B33]/10 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[13px] font-semibold text-[#0C1B33]">
          {cluster.ownerName || "Owner record unavailable"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono-bureau text-[9px] uppercase tracking-[0.1em] text-[#0C1B33]/45">
            {ownerTypeLabel(cluster.ownerType)}
          </span>
          <span
            className={`px-1.5 py-0.5 font-mono-bureau text-[9px] uppercase tracking-[0.08em] ${
              CONFIDENCE_BADGE[cluster.confidence] ?? CONFIDENCE_BADGE.Low
            }`}
          >
            {cluster.confidence}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 font-mono-bureau text-[11px] text-[#0C1B33]/55">
        <span>
          {cluster.clusterVacantCount} of {cluster.clusterParcelCount} parcels vacant
        </span>
        <Link href={ownerFileHref} className="text-[#2563EB] hover:underline">
          Open Owner File &rarr;
        </Link>
      </div>
    </div>
  );
}

export function AdminOwnershipPanel({
  status,
  zip,
  match,
  topClusters,
}: {
  status: AdminOwnershipPanelStatus;
  zip: string | null;
  match: OwnerFileReportMatch | null;
  topClusters: OwnerFileReportTopCluster[];
}) {
  if (status === "idle") return null;

  return (
    <div className="mx-5 my-5 border border-[#0C1B33]/10 bg-[#0C1B33]/[0.025] p-4 sm:mx-12 sm:p-5 md:mx-16 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#0C1B33]/45">
          Ownership Context
        </span>
        <AdminBadge />
      </div>

      {status === "loading" && (
        <p className="mt-3 text-[12px] text-[#0C1B33]/45">Checking ownership records…</p>
      )}

      {status === "error" && (
        <p className="mt-3 text-[12px] text-[#0C1B33]/45">
          Ownership records could not be loaded for this address.
        </p>
      )}

      {status === "ready" && (
        <>
          {match ? (
            <div className="mt-3">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/35">
                This address
              </p>
              <div className="mt-1.5">
                <ClusterRow
                  cluster={match}
                  ownerFileHref={`/admin/owner-files/${match.zip}/${encodeURIComponent(match.clusterKey)}`}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-[#0C1B33]/45">
              No parcel-level ownership match found for this address.
            </p>
          )}

          {topClusters.length > 0 && (
            <div className="mt-4">
              <p className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#0C1B33]/35">
                Top ownership clusters in ZIP {zip}
              </p>
              <div className="mt-1.5 space-y-1.5">
                {topClusters.map((cluster) => (
                  <ClusterRow
                    key={cluster.clusterKey}
                    cluster={cluster}
                    ownerFileHref={`/admin/owner-files/${cluster.zip}/${encodeURIComponent(cluster.clusterKey)}`}
                  />
                ))}
              </div>
            </div>
          )}

          <p className="mt-4 text-[10px] italic leading-relaxed text-[#0C1B33]/40">
            Internal — records indicate; verify before relying. Not included in shared/emailed reports.
          </p>
        </>
      )}
    </div>
  );
}
