"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import type { GeneratedReport } from "@/lib/report-engine";
import type { WizardState } from "@/lib/report-wizard-config";
import { trackEvent } from "@/lib/analytics-events";
import {
  extractPreparationContext,
  PREPARATION_CONTEXT_STORAGE_KEY,
} from "./report-context";

const NEW_PACKET_PATH = "/workspace/incentive-preparation/new";

interface StartPreparationPacketButtonProps {
  report: GeneratedReport;
  wizardState?: WizardState;
  source: string;
  className?: string;
}

export function StartPreparationPacketButton({
  report,
  wizardState,
  source,
  className = "",
}: StartPreparationPacketButtonProps) {
  const router = useRouter();
  const { status } = useSession();

  const startPacket = () => {
    const context = extractPreparationContext(report, wizardState);
    window.sessionStorage.setItem(
      PREPARATION_CONTEXT_STORAGE_KEY,
      JSON.stringify(context),
    );

    trackEvent("preparation_packet_started", {
      reportType: report.reportType,
      source,
      address: context.address || null,
      metadata: {
        programCandidateCount: context.programs.length,
        hasIndustry: Boolean(context.industry),
      },
    });

    if (status === "authenticated") {
      router.push(NEW_PACKET_PATH);
      return;
    }

    router.push(
      `/login?callbackUrl=${encodeURIComponent(NEW_PACKET_PATH)}`,
    );
  };

  return (
    <button
      type="button"
      onClick={startPacket}
      disabled={status === "loading"}
      className={`inline-flex min-h-11 items-center justify-center gap-2 bg-[#0F766E] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-normal text-white transition-colors hover:bg-[#115E59] disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {status === "loading" ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <FilePlus2 className="h-4 w-4" aria-hidden="true" />
      )}
      Start Preparation Packet
    </button>
  );
}

export {
  extractPreparationContext,
  parsePreparationContext,
  PREPARATION_CONTEXT_STORAGE_KEY,
} from "./report-context";
