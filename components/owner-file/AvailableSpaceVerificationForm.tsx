"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

const SOURCE_OPTIONS = [
  { value: "owner_confirmation", label: "Owner confirmation" },
  { value: "seccc_field_survey", label: "SECCC field verification" },
  { value: "cclba_record", label: "Cook County Land Bank record" },
  { value: "city_record", label: "City property record" },
  { value: "other_verified_record", label: "Other verified record" },
] as const;

interface AvailableSpaceVerificationFormProps {
  zip: string;
  clusterKey: string;
  pins: string[];
}

export function AvailableSpaceVerificationForm({
  zip,
  clusterKey,
  pins,
}: AvailableSpaceVerificationFormProps) {
  const router = useRouter();
  const [pin, setPin] = useState(pins[0] ?? "");
  const [availableSpaceSqft, setAvailableSpaceSqft] = useState("");
  const [sourceKey, setSourceKey] = useState<(typeof SOURCE_OPTIONS)[number]["value"]>(
    "owner_confirmation",
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [verifiedAt, setVerifiedAt] = useState(new Date().toISOString().slice(0, 10));
  const [verifierName, setVerifierName] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setError("");
    setSaved(false);
    if (!pin) {
      setError("Select a PIN.");
      return;
    }
    if (!confirmed) {
      setError("Confirm that the number is usable vacant interior space.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/parcel-space", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          zip,
          clusterKey,
          availableSpaceSqft: Number(availableSpaceSqft),
          sourceKey,
          sourceUrl: sourceUrl.trim() || null,
          verifiedAt,
          verifierName: verifierName.trim(),
          notes: notes.trim() || null,
          confirmedUsableVacantInteriorSpace: confirmed,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save available space");
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save available space");
    } finally {
      setSaving(false);
    }
  }

  if (pins.length === 0) return null;

  const inputClass =
    "mt-1.5 h-10 w-full border border-[#0C1B33]/15 bg-white px-3 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]";
  const labelClass =
    "font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45";

  return (
    <div className="mt-4 border border-[#0C1B33]/10 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-[#0C1B33]">Available interior space</h3>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[#0C1B33]/50">
            Record the largest contiguous usable vacant interior space currently available. Do not
            add separate suites together. Lot area, assessor building area, and mapped ground
            coverage do not establish availability.
          </p>
        </div>
        <span className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB]">
          PIN-level record
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label>
          <span className={labelClass}>PIN</span>
          <select value={pin} onChange={(event) => setPin(event.target.value)} className={inputClass}>
            {pins.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelClass}>Verified available square feet</span>
          <input
            type="number"
            min="1"
            max="2000000"
            step="1"
            value={availableSpaceSqft}
            onChange={(event) => setAvailableSpaceSqft(event.target.value)}
            className={inputClass}
          />
        </label>
        <label>
          <span className={labelClass}>Source type</span>
          <select
            value={sourceKey}
            onChange={(event) =>
              setSourceKey(event.target.value as (typeof SOURCE_OPTIONS)[number]["value"])
            }
            className={inputClass}
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelClass}>Verified date</span>
          <input
            type="date"
            value={verifiedAt}
            onChange={(event) => setVerifiedAt(event.target.value)}
            className={inputClass}
          />
        </label>
        <label>
          <span className={labelClass}>Verifier name</span>
          <input
            value={verifierName}
            onChange={(event) => setVerifierName(event.target.value)}
            className={inputClass}
          />
        </label>
        <label>
          <span className={labelClass}>Source URL</span>
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://"
            className={inputClass}
          />
        </label>
        <label className="sm:col-span-2 lg:col-span-3">
          <span className={labelClass}>Verification notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="mt-1.5 w-full border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
          />
        </label>
      </div>

      <label className="mt-4 flex items-start gap-2.5 border-t border-[#0C1B33]/8 pt-4">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#2563EB]"
        />
        <span className="text-[12px] leading-relaxed text-[#0C1B33]/65">
          I verified this as the largest contiguous usable vacant interior space currently
          available, not multiple suites added together, parcel area, whole-building area, or a
          calculated estimate. Reconfirm availability within 90 days.
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-10 items-center gap-2 bg-[#0C1B33] px-4 py-2 text-[11px] font-semibold text-white hover:bg-[#2563EB] disabled:cursor-wait disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? "Saving" : "Save verification"}
        </button>
        {error ? <p className="text-[11px] text-[#DC2626]">{error}</p> : null}
        {saved ? <p className="text-[11px] text-[#15803D]">Available space saved.</p> : null}
      </div>
    </div>
  );
}
