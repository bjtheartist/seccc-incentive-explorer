"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import type { OwnerFileNoteType, OwnerFileVerification, OwnerFileVerificationStatus } from "@/lib/owner-file";
import type { ChecklistItem } from "@/lib/workspace";

const IL_SOS_SEARCH_URL = "https://apps.ilsos.gov/businessentitysearch/";

/** Seeded when a cluster has no verification yet — mirrors the plan's Stage 3 checklist example. */
const DEFAULT_CHECKLIST_LABELS = [
  "Confirm entity standing on IL SOS Business Entity Search",
  "Cross-check mailing address on the latest tax bill",
  "Call or contact the registered agent",
];

function defaultChecklist(): ChecklistItem[] {
  return DEFAULT_CHECKLIST_LABELS.map((label, index) => ({
    id: `default-${index + 1}`,
    label,
    completed: false,
  }));
}

const STATUS_OPTIONS: { value: OwnerFileVerificationStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "verified", label: "Verified" },
  { value: "stale", label: "Stale" },
  { value: "superseded", label: "Superseded" },
];

const LOCAL_VS_ABSENTEE_OPTIONS = [
  { value: "", label: "Not assessed" },
  { value: "local", label: "Local (mailing ZIP matches parcel ZIP)" },
  { value: "absentee", label: "Absentee (mailing address outside the corridor)" },
  { value: "unknown", label: "Unknown / conflicting records" },
];

interface Props {
  zip: string;
  clusterKey: string;
  verification: OwnerFileVerification | null;
  resolvedTier: "A" | "B" | "C" | "D";
}

export function OwnerFileVerificationForm({ zip, clusterKey, verification, resolvedTier }: Props) {
  const router = useRouter();
  const [verifierName, setVerifierName] = useState(verification?.verifierName ?? "");
  const [status, setStatus] = useState<OwnerFileVerificationStatus>(verification?.status ?? "draft");
  const [registeredAgentName, setRegisteredAgentName] = useState(verification?.registeredAgentName ?? "");
  const [registeredAgentAddress, setRegisteredAgentAddress] = useState(
    verification?.registeredAgentAddress ?? ""
  );
  const [ilSosFileNumber, setIlSosFileNumber] = useState(verification?.ilSosFileNumber ?? "");
  const [ilSosLookupUrl, setIlSosLookupUrl] = useState(verification?.ilSosLookupUrl ?? "");
  const [taxpayerMailingAddressConfirmed, setTaxpayerMailingAddressConfirmed] = useState(
    verification?.taxpayerMailingAddressConfirmed ?? false
  );
  const [localVsAbsentee, setLocalVsAbsentee] = useState(verification?.localVsAbsentee ?? "");
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    verification?.checklist && verification.checklist.length > 0 ? verification.checklist : defaultChecklist()
  );
  const [newChecklistLabel, setNewChecklistLabel] = useState("");
  const [noteType, setNoteType] = useState<OwnerFileNoteType>("entity_lookup");
  const [noteBody, setNoteBody] = useState("");
  const [noteSourceUrl, setNoteSourceUrl] = useState(IL_SOS_SEARCH_URL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedTier, setSavedTier] = useState<string | null>(null);

  function toggleChecklistItem(id: string) {
    setChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
    );
  }

  function addChecklistItem() {
    const label = newChecklistLabel.trim();
    if (!label) return;
    setChecklist((items) => [...items, { id: `custom-${Date.now()}`, label, completed: false }]);
    setNewChecklistLabel("");
  }

  async function save() {
    if (!verifierName.trim()) {
      setError("Your name is required to save a verification.");
      return;
    }
    setSaving(true);
    setError("");
    setSavedTier(null);

    try {
      const res = await fetch(`/api/owner-file/${encodeURIComponent(clusterKey)}/verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip,
          verifierName: verifierName.trim(),
          status,
          registeredAgentName: registeredAgentName.trim() || null,
          registeredAgentAddress: registeredAgentAddress.trim() || null,
          ilSosFileNumber: ilSosFileNumber.trim() || null,
          ilSosLookupUrl: ilSosLookupUrl.trim() || null,
          taxpayerMailingAddressConfirmed,
          localVsAbsentee: localVsAbsentee || null,
          checklist,
          note: noteBody.trim()
            ? { noteType, body: noteBody.trim(), sourceUrl: noteSourceUrl.trim() || null }
            : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the verification");

      trackEvent("owner_file_verification_saved", {
        source: "owner_file_verification_form",
        metadata: { clusterKey, zip, status, resolvedTier: data.resolvedTier ?? null },
      });

      setSavedTier(data.resolvedTier ?? null);
      setNoteBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the verification");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-[#0C1B33]/10 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-editorial text-[24px] text-[#0C1B33]">Verification</h2>
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.16em] text-[#0C1B33]/40">
          Current tier: {resolvedTier}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[#0C1B33]/50">
        Tier A requires a verified status plus either an IL SOS lookup URL or an entity-lookup note below —
        an algorithm never assigns Tier A. Bulk IL SOS access is prohibited; look up this entity individually
        and paste back what you find.
      </p>

      <a
        href={IL_SOS_SEARCH_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 border border-[#2563EB]/30 bg-[#2563EB]/5 px-4 py-2 text-[12px] text-[#2563EB] hover:bg-[#2563EB]/10"
      >
        Open IL SOS Business Entity Search <ExternalLink className="h-3.5 w-3.5" />
      </a>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
            Your name (verifier) *
          </span>
          <input
            value={verifierName}
            onChange={(e) => setVerifierName(e.target.value)}
            className="mt-1.5 w-full border border-[#0C1B33]/15 px-3 py-2 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="Jane Corridor Manager"
          />
        </label>

        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
            Status
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as OwnerFileVerificationStatus)}
            className="mt-1.5 w-full border border-[#0C1B33]/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-[#2563EB]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
            IL SOS file number
          </span>
          <input
            value={ilSosFileNumber}
            onChange={(e) => setIlSosFileNumber(e.target.value)}
            className="mt-1.5 w-full border border-[#0C1B33]/15 px-3 py-2 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="e.g. 65432100"
          />
        </label>

        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
            IL SOS lookup URL
          </span>
          <input
            value={ilSosLookupUrl}
            onChange={(e) => setIlSosLookupUrl(e.target.value)}
            className="mt-1.5 w-full border border-[#0C1B33]/15 px-3 py-2 text-[14px] outline-none focus:border-[#2563EB]"
            placeholder="https://apps.ilsos.gov/businessentitysearch/..."
          />
        </label>

        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
            Registered agent name
          </span>
          <input
            value={registeredAgentName}
            onChange={(e) => setRegisteredAgentName(e.target.value)}
            className="mt-1.5 w-full border border-[#0C1B33]/15 px-3 py-2 text-[14px] outline-none focus:border-[#2563EB]"
          />
        </label>

        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
            Registered agent address
          </span>
          <input
            value={registeredAgentAddress}
            onChange={(e) => setRegisteredAgentAddress(e.target.value)}
            className="mt-1.5 w-full border border-[#0C1B33]/15 px-3 py-2 text-[14px] outline-none focus:border-[#2563EB]"
          />
        </label>

        <label className="block">
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
            Local vs. absentee
          </span>
          <select
            value={localVsAbsentee}
            onChange={(e) => setLocalVsAbsentee(e.target.value)}
            className="mt-1.5 w-full border border-[#0C1B33]/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-[#2563EB]"
          >
            {LOCAL_VS_ABSENTEE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            checked={taxpayerMailingAddressConfirmed}
            onChange={(e) => setTaxpayerMailingAddressConfirmed(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-[13px] text-[#0C1B33]/65">
            Taxpayer mailing address confirmed against a current source (e.g. latest tax bill)
          </span>
        </label>
      </div>

      <div className="mt-6">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
          Verification checklist
        </span>
        <div className="mt-2 space-y-2">
          {checklist.map((item) => (
            <label key={item.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item.completed}
                onChange={() => toggleChecklistItem(item.id)}
                className="mt-0.5 h-4 w-4"
              />
              <span className={`text-[13px] ${item.completed ? "text-[#0C1B33]/40 line-through" : "text-[#0C1B33]/75"}`}>
                {item.label}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newChecklistLabel}
            onChange={(e) => setNewChecklistLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addChecklistItem();
              }
            }}
            placeholder="Add a checklist item"
            className="flex-1 border border-[#0C1B33]/15 px-3 py-2 text-[13px] outline-none focus:border-[#2563EB]"
          />
          <button
            type="button"
            onClick={addChecklistItem}
            className="inline-flex items-center gap-1 border border-[#0C1B33]/15 px-3 py-2 text-[12px] text-[#0C1B33]/60 hover:border-[#0C1B33]/30"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-[#0C1B33]/8 pt-6">
        <span className="font-mono-bureau text-[10px] uppercase tracking-[0.14em] text-[#0C1B33]/45">
          Add a note (optional — paste back what you found)
        </span>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
          <select
            value={noteType}
            onChange={(e) => setNoteType(e.target.value as OwnerFileNoteType)}
            className="border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#2563EB]"
          >
            <option value="entity_lookup">Entity lookup</option>
            <option value="transfer_observation">Transfer observation</option>
            <option value="distress_observation">Distress observation</option>
            <option value="general">General</option>
          </select>
          <input
            value={noteSourceUrl}
            onChange={(e) => setNoteSourceUrl(e.target.value)}
            placeholder="Source URL (optional)"
            className="border border-[#0C1B33]/15 px-3 py-2 text-[13px] outline-none focus:border-[#2563EB]"
          />
        </div>
        <textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          rows={3}
          placeholder="e.g. Confirmed active/good standing on IL SOS Business Entity Search for [Entity Name], file #..."
          className="mt-2 w-full border border-[#0C1B33]/15 px-3 py-2 text-[13px] outline-none focus:border-[#2563EB]"
        />
      </div>

      {error && (
        <p className="mt-4 border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</p>
      )}
      {savedTier && !error && (
        <p className="mt-4 border border-[#16A34A]/20 bg-[#16A34A]/5 px-3 py-2 text-[12px] text-[#16A34A]">
          Saved. Resolved confidence tier: {savedTier}.
        </p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="mt-5 inline-flex items-center justify-center gap-2 bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[11px] uppercase tracking-[0.16em] text-white hover:bg-[#1E3054] disabled:opacity-60"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save verification
      </button>
    </div>
  );
}
