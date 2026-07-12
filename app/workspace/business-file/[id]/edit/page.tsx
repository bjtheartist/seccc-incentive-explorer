"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Building2, Check, Loader2 } from "lucide-react";

const inputClassName =
  "min-h-11 w-full border border-[#0C1B33]/15 bg-white px-3.5 py-2.5 text-sm text-[#0C1B33] outline-none transition-colors placeholder:text-[#0C1B33]/25 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10";

interface ProfileDraft {
  legalName: string;
  dbaName: string;
  physicalAddress: string;
  mailingAddress: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  entityType: string;
  formationDate: string;
  industry: string;
  naicsCode: string;
  employeeCount: string;
  ownershipNotes: string;
}

const EMPTY_DRAFT: ProfileDraft = {
  legalName: "",
  dbaName: "",
  physicalAddress: "",
  mailingAddress: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  entityType: "",
  formationDate: "",
  industry: "",
  naicsCode: "",
  employeeCount: "",
  ownershipNotes: "",
};

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function responseError(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function draftFromProfile(record: Record<string, unknown>): ProfileDraft {
  return {
    legalName: readString(record, "legalName"),
    dbaName: readString(record, "dbaName"),
    physicalAddress: readString(record, "physicalAddress"),
    mailingAddress: readString(record, "mailingAddress"),
    contactName: readString(record, "contactName"),
    contactEmail: readString(record, "contactEmail"),
    contactPhone: readString(record, "contactPhone"),
    entityType: readString(record, "entityType"),
    formationDate: readString(record, "formationDate"),
    industry: readString(record, "industry"),
    naicsCode: readString(record, "naicsCode"),
    employeeCount: readString(record, "employeeCount"),
    ownershipNotes: readString(record, "ownershipNotes"),
  };
}

export default function EditBusinessFilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const editPath = `/workspace/business-file/${params.id}/edit`;

  useEffect(() => {
    const id = params.id;
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(editPath)}`);
      return;
    }
    if (status !== "authenticated") return;

    let active = true;
    fetch(`/api/business-profiles/${id}`)
      .then(async (response) => {
        const body = await responseBody(response);
        if (response.status === 401) {
          router.replace(`/login?callbackUrl=${encodeURIComponent(editPath)}`);
          return null;
        }
        if (response.status === 404) {
          router.replace("/workspace/business-file");
          return null;
        }
        if (!response.ok) throw new Error(responseError(body, "Could not load this Business File."));
        return body;
      })
      .then((body) => {
        if (!active || !body) return;
        const profile = body.profile;
        if (profile && typeof profile === "object" && !Array.isArray(profile)) {
          setDraft(draftFromProfile(profile as Record<string, unknown>));
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load this Business File.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // editPath is derived from params.id; excluded to avoid a re-fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, router, status]);

  const updateField = (field: keyof ProfileDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const employeeCountValue = draft.employeeCount.trim();
    if (employeeCountValue && !Number.isInteger(Number(employeeCountValue))) {
      setError("Employee count must be a whole number.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/business-profiles/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: draft.legalName.trim(),
          dbaName: draft.dbaName.trim() || null,
          physicalAddress: draft.physicalAddress.trim(),
          mailingAddress: draft.mailingAddress.trim() || null,
          contactName: draft.contactName.trim(),
          contactEmail: draft.contactEmail.trim(),
          contactPhone: draft.contactPhone.trim() || null,
          entityType: draft.entityType.trim() || null,
          formationDate: draft.formationDate.trim() || null,
          industry: draft.industry.trim() || null,
          naicsCode: draft.naicsCode.trim() || null,
          employeeCount: employeeCountValue ? Number(employeeCountValue) : null,
          ownershipNotes: draft.ownershipNotes.trim() || null,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(responseError(body, "Could not save this Business File."));
      router.push("/workspace/business-file");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this Business File.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6]">
        <Loader2 className="h-5 w-5 animate-spin text-[#0C1B33]/40" />
      </div>
    );
  }
  if (status !== "authenticated") return null;

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-10 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/workspace/business-file"
          className="mb-8 inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45 hover:text-[#0C1B33]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Business File
        </Link>

        <header className="mb-8">
          <p className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.25em] text-[#2563EB]/70">
            Edit Business File
          </p>
          <h1 className="mb-2 font-editorial text-3xl leading-tight text-[#0C1B33]">
            Update your business facts
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-[#0C1B33]/55">
            These facts carry into every application you prepare. Saving here
            updates your live Business File; each application confirms its own
            copy separately.
          </p>
        </header>

        {error && (
          <div role="alert" className="mb-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={submit} noValidate className="border border-[#0C1B33]/10 bg-white">
          <section className="border-b border-[#0C1B33]/8 px-5 py-6 sm:px-7">
            <div className="mb-5 flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2563EB]" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-[#0C1B33]">Business File facts</h2>
                <p className="mt-1 text-xs leading-5 text-[#0C1B33]/45">Reused in every application you prepare.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
              <TextField id="legal-name" label="Legal business name" value={draft.legalName} onChange={(v) => updateField("legalName", v)} required autoComplete="organization" />
              <TextField id="dba-name" label="Doing business as" value={draft.dbaName} onChange={(v) => updateField("dbaName", v)} autoComplete="organization" />
              <TextField id="physical-address" label="Physical or project address" value={draft.physicalAddress} onChange={(v) => updateField("physicalAddress", v)} required autoComplete="street-address" />
              <TextField id="mailing-address" label="Mailing address" value={draft.mailingAddress} onChange={(v) => updateField("mailingAddress", v)} autoComplete="street-address" />
              <TextField id="contact-name" label="Contact name" value={draft.contactName} onChange={(v) => updateField("contactName", v)} required autoComplete="name" />
              <TextField id="contact-email" label="Contact email" value={draft.contactEmail} onChange={(v) => updateField("contactEmail", v)} required type="email" autoComplete="email" />
              <TextField id="contact-phone" label="Contact phone" value={draft.contactPhone} onChange={(v) => updateField("contactPhone", v)} type="tel" autoComplete="tel" />
              <TextField id="entity-type" label="Entity type" value={draft.entityType} onChange={(v) => updateField("entityType", v)} placeholder="Example: LLC" />
              <TextField id="formation-date" label="Formation date" value={draft.formationDate} onChange={(v) => updateField("formationDate", v)} type="date" />
              <TextField id="industry" label="Industry" value={draft.industry} onChange={(v) => updateField("industry", v)} />
              <TextField id="naics-code" label="NAICS code" value={draft.naicsCode} onChange={(v) => updateField("naicsCode", v)} inputMode="numeric" />
              <TextField id="employee-count" label="Employee count" value={draft.employeeCount} onChange={(v) => updateField("employeeCount", v)} inputMode="numeric" />
              <div className="md:col-span-2">
                <label htmlFor="ownership-notes" className="mb-1.5 block text-xs font-medium text-[#0C1B33]/70">
                  Ownership notes
                </label>
                <textarea
                  id="ownership-notes"
                  value={draft.ownershipNotes}
                  onChange={(event) => updateField("ownershipNotes", event.target.value)}
                  rows={3}
                  className="w-full border border-[#0C1B33]/15 bg-white px-3.5 py-2.5 text-sm text-[#0C1B33] outline-none transition-colors placeholder:text-[#0C1B33]/25 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10"
                />
              </div>
            </div>
          </section>

          <footer className="flex flex-col gap-3 px-5 py-6 sm:flex-row sm:items-center sm:justify-end sm:px-7">
            <Link
              href="/workspace/business-file"
              className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#0C1B33]/20 px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33] hover:bg-[#0C1B33]/[0.04]"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white hover:bg-[#1E3054] disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              Save Business File
            </button>
          </footer>
        </form>
      </div>
    </main>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  required = false,
  type = "text",
  autoComplete,
  inputMode,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-[#0C1B33]/70">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-required={required}
        className={inputClassName}
      />
    </div>
  );
}
