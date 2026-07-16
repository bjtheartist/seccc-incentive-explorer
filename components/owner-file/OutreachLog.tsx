"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { generateOutreachLetter } from "@/lib/outreach-letter";
import type { ParcelProgramContext } from "@/lib/owner-file-letter-context";
import type { OwnerFileOutreachEvent, OwnerFileOutreachOutcome } from "@/lib/owner-file";

const OUTCOME_OPTIONS: { value: OwnerFileOutreachOutcome; label: string }[] = [
  { value: "no_response", label: "No response" },
  { value: "responded", label: "Responded" },
  { value: "meeting_scheduled", label: "Meeting scheduled" },
  { value: "returned_undeliverable", label: "Returned undeliverable" },
  { value: "sold", label: "Sold" },
  { value: "other", label: "Other" },
];

function formatEventType(eventType: string) {
  return eventType.replace(/_/g, " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(value)
  );
}

interface Props {
  zip: string;
  clusterKey: string;
  ownerName: string | null;
  ownerMailingAddress: string | null;
  verificationStatus: string | null;
  events: OwnerFileOutreachEvent[];
}

export function OutreachLog({ zip, clusterKey, ownerName, ownerMailingAddress, verificationStatus, events }: Props) {
  const router = useRouter();
  const isVerified = verificationStatus === "verified";

  const [corridorManagerName, setCorridorManagerName] = useState("");
  const [corridorManagerContact, setCorridorManagerContact] = useState("");
  const [generating, setGenerating] = useState(false);
  const [letterError, setLetterError] = useState("");
  const [lastResolvedContext, setLastResolvedContext] = useState<ParcelProgramContext[] | null>(null);

  const [outcome, setOutcome] = useState<OwnerFileOutreachOutcome>("no_response");
  const [actorName, setActorName] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [loggingOutcome, setLoggingOutcome] = useState(false);
  const [outcomeError, setOutcomeError] = useState("");

  async function postOutreachEvent(payload: Record<string, unknown>) {
    const res = await fetch(`/api/owner-file/${encodeURIComponent(clusterKey)}/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zip, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not log the outreach event");
    return data;
  }

  async function generateLetter() {
    if (!isVerified) {
      setLetterError("This Owner File must be verified before generating an outreach letter.");
      return;
    }
    if (!corridorManagerName.trim()) {
      setLetterError("Corridor manager name is required to generate a letter.");
      return;
    }

    setGenerating(true);
    setLetterError("");
    try {
      const generatedData = await postOutreachEvent({
        eventType: "letter_generated",
        actorName: corridorManagerName.trim(),
      });
      const parcelProgramContext: ParcelProgramContext[] = generatedData.parcelProgramContext || [];
      setLastResolvedContext(parcelProgramContext);

      trackEvent("outreach_letter_generated", {
        source: "owner_file_outreach_log",
        metadata: { clusterKey, zip, parcelCount: parcelProgramContext.length },
      });

      generateOutreachLetter({
        ownerName: ownerName || "Owner of Record",
        ownerMailingAddress: ownerMailingAddress || "",
        corridorManagerName: corridorManagerName.trim(),
        corridorManagerContact: corridorManagerContact.trim(),
        zip,
        clusterKey,
        verificationStatus: "verified",
        parcelProgramContext,
      });

      await postOutreachEvent({
        eventType: "letter_downloaded",
        actorName: corridorManagerName.trim(),
      });
      trackEvent("outreach_letter_downloaded", {
        source: "owner_file_outreach_log",
        metadata: { clusterKey, zip },
      });

      router.refresh();
    } catch (err) {
      setLetterError(err instanceof Error ? err.message : "Could not generate the outreach letter");
    } finally {
      setGenerating(false);
    }
  }

  async function logOutcome() {
    if (!actorName.trim()) {
      setOutcomeError("Your name is required to log an outcome.");
      return;
    }
    setLoggingOutcome(true);
    setOutcomeError("");
    try {
      await postOutreachEvent({
        eventType: "outcome_logged",
        actorName: actorName.trim(),
        outcome,
        notes: outcomeNotes.trim() || null,
      });
      trackEvent("outreach_outcome_logged", {
        source: "owner_file_outreach_log",
        metadata: { clusterKey, zip, outcome },
      });
      setOutcomeNotes("");
      router.refresh();
    } catch (err) {
      setOutcomeError(err instanceof Error ? err.message : "Could not log the outcome");
    } finally {
      setLoggingOutcome(false);
    }
  }

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-6">
      <h2 className="font-editorial text-[24px] text-[#0C1B33]">Outreach</h2>

      <div className="mt-5 border border-[#0C1B33]/8 bg-[#FAF9F6] p-5">
        <h3 className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
          Generate outreach letter
        </h3>
        {!isVerified && (
          <p className="mt-2 text-[12px] text-[#0C1B33]/45">
            Save a verification with status &quot;Verified&quot; above before generating a letter.
          </p>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={corridorManagerName}
            onChange={(e) => setCorridorManagerName(e.target.value)}
            disabled={!isVerified}
            placeholder="Corridor manager name"
            className="border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#2563EB] disabled:opacity-50"
          />
          <input
            value={corridorManagerContact}
            onChange={(e) => setCorridorManagerContact(e.target.value)}
            disabled={!isVerified}
            placeholder="Contact (email or phone)"
            className="border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#2563EB] disabled:opacity-50"
          />
        </div>
        {letterError && <p className="mt-3 text-[12px] text-red-600">{letterError}</p>}
        {lastResolvedContext && !letterError && (
          <p className="mt-3 text-[12px] text-[#16A34A]">
            Letter generated and downloaded — resolved incentive context for {lastResolvedContext.length}{" "}
            parcel{lastResolvedContext.length === 1 ? "" : "s"}.
          </p>
        )}
        <button
          onClick={generateLetter}
          disabled={!isVerified || generating}
          className="mt-4 inline-flex items-center justify-center gap-2 bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white hover:bg-[#1E3054] disabled:opacity-40"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          Generate &amp; download letter
        </button>
      </div>

      <div className="mt-6 border border-[#0C1B33]/8 p-5">
        <h3 className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
          Log an outcome
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={actorName}
            onChange={(e) => setActorName(e.target.value)}
            placeholder="Your name"
            className="border border-[#0C1B33]/15 px-3 py-2 text-[13px] outline-none focus:border-[#2563EB]"
          />
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as OwnerFileOutreachOutcome)}
            className="border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#2563EB]"
          >
            {OUTCOME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={outcomeNotes}
          onChange={(e) => setOutcomeNotes(e.target.value)}
          rows={2}
          placeholder="Notes (optional)"
          className="mt-3 w-full border border-[#0C1B33]/15 px-3 py-2 text-[13px] outline-none focus:border-[#2563EB]"
        />
        {outcomeError && <p className="mt-3 text-[12px] text-red-600">{outcomeError}</p>}
        <button
          onClick={logOutcome}
          disabled={loggingOutcome}
          className="mt-4 inline-flex items-center gap-2 border border-[#0C1B33]/15 px-4 py-2.5 font-mono-bureau text-[11px] uppercase tracking-[0.14em] text-[#0C1B33]/70 hover:border-[#0C1B33]/30 disabled:opacity-50"
        >
          {loggingOutcome && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Log outcome
        </button>
      </div>

      <div className="mt-6">
        <h3 className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/55">
          Event history
        </h3>
        {events.length === 0 ? (
          <p className="mt-2 text-[13px] text-[#0C1B33]/45">No outreach logged yet.</p>
        ) : (
          <div className="mt-2 divide-y divide-[#0C1B33]/6">
            {events.map((event) => (
              <div key={event.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] capitalize text-[#0C1B33]/75">{formatEventType(event.eventType)}</span>
                  <span className="font-mono-bureau text-[10px] text-[#0C1B33]/35">{formatDate(event.occurredAt)}</span>
                </div>
                <p className="mt-1 text-[12px] text-[#0C1B33]/45">
                  {[event.actorName, event.outcome ? `outcome: ${formatEventType(event.outcome)}` : null, event.notes]
                    .filter(Boolean)
                    .join(" — ") || "No additional detail"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
