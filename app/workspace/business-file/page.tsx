"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ClipboardCheck,
  FilePlus2,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";

interface FoundationSummary {
  confirmed: number;
  total: number;
}

interface BusinessFileProfile {
  id: string;
  legalName: string | null;
  dbaName: string | null;
  physicalAddress: string | null;
  contactName: string | null;
  contactEmail: string | null;
  industry: string | null;
  foundationSummary?: FoundationSummary | null;
}

interface BusinessFilePacket {
  id: string;
  title: string;
  businessProfileId: string | null;
  programName: string;
  status: string;
  projectAddress: string | null;
  updatedAt: string;
}

const PREPARATION_STATUS_LABELS: Record<string, string> = {
  foundation_complete: "Foundation complete",
  needs_information: "Needs information",
  waiting_on_others: "Waiting on others",
  needs_advisor: "Needs advisor review",
  requires_certification: "Applicant certification required",
  ready_to_submit: "Prepared for applicant certification",
};

function preparationStatusLabel(status: string): string {
  return PREPARATION_STATUS_LABELS[status] || "In preparation";
}

function newPacketPath(profileId: string): string {
  return `/workspace/incentive-preparation/new?profileId=${encodeURIComponent(profileId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProfile(value: unknown): BusinessFileProfile | null {
  const record = asRecord(value);
  const id = record ? readString(record, "id") : null;
  if (!record || !id) return null;
  const summary = asRecord(record.foundationSummary);
  const confirmed = summary ? Number(summary.confirmed) : NaN;
  const total = summary ? Number(summary.total) : NaN;
  return {
    id,
    legalName: readString(record, "legalName"),
    dbaName: readString(record, "dbaName"),
    physicalAddress: readString(record, "physicalAddress"),
    contactName: readString(record, "contactName"),
    contactEmail: readString(record, "contactEmail"),
    industry: readString(record, "industry"),
    foundationSummary:
      Number.isFinite(confirmed) && Number.isFinite(total)
        ? { confirmed, total }
        : null,
  };
}

function normalizePacket(value: unknown): BusinessFilePacket | null {
  const record = asRecord(value);
  const id = record ? readString(record, "id") : null;
  if (!record || !id) return null;
  return {
    id,
    title: readString(record, "title") || "Preparation packet",
    businessProfileId: readString(record, "businessProfileId"),
    programName: readString(record, "programName") || "",
    status: readString(record, "status") || "",
    projectAddress: readString(record, "projectAddress"),
    updatedAt: readString(record, "updatedAt") || "",
  };
}

export default function BusinessFileHomePage() {
  const { status } = useSession();
  const router = useRouter();
  const [profiles, setProfiles] = useState<BusinessFileProfile[] | null>(null);
  const [packets, setPackets] = useState<BusinessFilePacket[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login?callbackUrl=/workspace/business-file");
      return;
    }
    if (status !== "authenticated") return;

    let active = true;
    Promise.all([
      fetch("/api/business-profiles").then((res) => res.json()),
      fetch("/api/incentive-preparation").then((res) => res.json()),
    ])
      .then(([profileData, packetData]) => {
        if (!active) return;
        const loadedProfiles = Array.isArray(profileData?.profiles)
          ? profileData.profiles
              .map(normalizeProfile)
              .filter((value: BusinessFileProfile | null): value is BusinessFileProfile => value !== null)
          : [];
        const loadedPackets = Array.isArray(packetData?.packets)
          ? packetData.packets
              .map(normalizePacket)
              .filter((value: BusinessFilePacket | null): value is BusinessFilePacket => value !== null)
          : [];
        setProfiles(loadedProfiles);
        setPackets(loadedPackets);
      })
      .catch(() => {
        if (active) setError("Could not load your Business File.");
      });

    return () => {
      active = false;
    };
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" || profiles === null) return;
    trackEvent("business_file_home_viewed", {
      source: "business_file_home",
      metadata: { profileCount: profiles.length },
    });
    // Fire once per load, keyed on profiles becoming available.
  }, [status, profiles]);

  const packetsByProfile = useMemo(() => {
    const grouped = new Map<string, BusinessFilePacket[]>();
    for (const packet of packets ?? []) {
      if (!packet.businessProfileId) continue;
      const list = grouped.get(packet.businessProfileId) ?? [];
      list.push(packet);
      grouped.set(packet.businessProfileId, list);
    }
    return grouped;
  }, [packets]);

  const isLoading =
    status === "loading" ||
    (status === "authenticated" && (profiles === null || packets === null));

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6]">
        <Loader2 className="h-5 w-5 animate-spin text-[#0C1B33]/40" />
      </div>
    );
  }

  if (status !== "authenticated") return null;

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/workspace"
          className="mb-8 inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45 hover:text-[#0C1B33]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Workspace
        </Link>

        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.25em] text-[#2563EB]/70">
              Business File
            </p>
            <h1 className="mb-2 font-editorial text-4xl leading-tight text-[#0C1B33]">
              Your Business File
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-[#0C1B33]/55">
              The business facts you enter once and reuse for every application
              you prepare. Program administrators make final eligibility and
              award determinations.
            </p>
          </div>
          <Link
            href="/workspace/incentive-preparation/new"
            className="inline-flex shrink-0 items-center justify-center gap-2 bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white hover:bg-[#1E3054]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New Business File
          </Link>
        </header>

        {error && (
          <div className="mb-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {(profiles ?? []).length === 0 ? (
          <div className="border border-dashed border-[#0C1B33]/15 bg-white px-6 py-12 text-center">
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center bg-[#0C1B33]/[0.04] text-[#0C1B33]/35">
              <Building2 className="h-5 w-5" />
            </div>
            <h2 className="mb-1 text-sm font-medium text-[#0C1B33]/75">
              No Business File yet
            </h2>
            <p className="mb-4 text-[12px] text-[#0C1B33]/40">
              Create your Business File once, then reuse it for every application
              you prepare.
            </p>
            <Link
              href="/workspace/incentive-preparation/new"
              className="inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#2563EB] hover:text-[#1d4ed8]"
            >
              Create your Business File
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {(profiles ?? []).map((profile) => {
              const summary = profile.foundationSummary;
              const profilePackets = packetsByProfile.get(profile.id) ?? [];
              return (
                <section
                  key={profile.id}
                  className="border border-[#0C1B33]/10 bg-white"
                >
                  <div className="flex flex-col gap-4 border-b border-[#0C1B33]/8 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-[#0C1B33]">
                        {profile.dbaName || profile.legalName || "Business profile"}
                      </h2>
                      <p className="mt-1 text-sm text-[#0C1B33]/55">
                        {profile.physicalAddress || "Address to be confirmed"}
                      </p>
                      {summary && (
                        <p className="mt-3 inline-flex items-center gap-2 border border-[#0C1B33]/12 bg-[#FAF9F6] px-2.5 py-1 font-mono-bureau text-[9px] uppercase tracking-[0.13em] text-[#0C1B33]/55">
                          {summary.confirmed} of {summary.total} basics confirmed
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/workspace/business-file/${profile.id}/edit`}
                      className="inline-flex shrink-0 items-center gap-2 border border-[#0C1B33]/20 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33] hover:bg-[#0C1B33]/[0.04]"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit profile
                    </Link>
                  </div>

                  <div className="px-5 py-5 sm:px-6">
                    <p className="font-mono-bureau text-[9px] uppercase tracking-[0.16em] text-[#0C1B33]/45">
                      Applications from this Business File
                    </p>
                    {profilePackets.length === 0 ? (
                      <p className="mt-3 text-sm text-[#0C1B33]/45">
                        No applications started from this Business File yet.
                      </p>
                    ) : (
                      <ul className="mt-3 divide-y divide-[#0C1B33]/6 border border-[#0C1B33]/8">
                        {profilePackets.map((packet) => (
                          <li key={packet.id}>
                            <Link
                              href={`/workspace/incentive-preparation/${packet.id}`}
                              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#0C1B33]/[0.02]"
                            >
                              <div className="min-w-0">
                                <p className="font-mono-bureau text-[9px] uppercase tracking-[0.14em] text-[#2563EB]/70">
                                  {preparationStatusLabel(packet.status)}
                                </p>
                                <p className="mt-0.5 truncate text-sm font-medium text-[#0C1B33]/80">
                                  {packet.title}
                                </p>
                                {(packet.programName || packet.projectAddress) && (
                                  <p className="mt-0.5 truncate text-[12px] text-[#0C1B33]/35">
                                    {[packet.programName, packet.projectAddress]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                              </div>
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#0C1B33]/30" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Link
                        href={newPacketPath(profile.id)}
                        className="inline-flex min-h-10 items-center justify-center gap-2 bg-[#0C1B33] px-4 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-white hover:bg-[#1E3054]"
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Start a program application
                      </Link>
                      <Link
                        href={newPacketPath(profile.id)}
                        className="inline-flex min-h-10 items-center justify-center gap-2 border border-[#0C1B33]/20 px-4 py-2 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33] hover:bg-[#0C1B33]/[0.04]"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Start Business File only
                      </Link>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
