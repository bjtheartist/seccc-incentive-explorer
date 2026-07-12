"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  Loader2,
} from "lucide-react";
import {
  buildFoundationPayload,
  buildPreparationPayload,
  draftFromContext,
  draftFromProfile,
  selectProgramCandidate,
  validateBusinessFileIntake,
  validatePreparationIntake,
  type PreparationIntakeDraft,
  type PreparationIntakeErrors,
} from "@/components/incentive-preparation/intake";
import {
  parsePreparationContext,
  PREPARATION_CONTEXT_STORAGE_KEY,
  type PreparationContext,
} from "@/components/incentive-preparation/report-context";
import {
  extractBusinessProfiles,
  extractCreatedPreparationId,
  type BusinessProfile,
} from "@/components/incentive-preparation/types";
import { trackEvent } from "@/lib/analytics-events";
import { GOAL_OPTIONS } from "@/lib/workspace";

const NEW_PACKET_PATH = "/workspace/incentive-preparation/new";

const inputClassName =
  "min-h-11 w-full border border-[#0C1B33]/15 bg-white px-3.5 py-2.5 text-sm text-[#0C1B33] outline-none transition-colors placeholder:text-[#0C1B33]/25 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/10 disabled:bg-[#0C1B33]/[0.03] disabled:text-[#0C1B33]/45";

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function responseError(
  body: Record<string, unknown>,
  fallback: string,
): string {
  return typeof body.error === "string" && body.error.trim()
    ? body.error
    : fallback;
}

export default function NewPreparationPacketPage() {
  return (
    <Suspense fallback={<PreparationPageLoading />}>
      <NewPreparationPacketContent />
    </Suspense>
  );
}

function PreparationPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6]">
      <Loader2
        className="h-5 w-5 animate-spin text-[#0C1B33]/40"
        aria-label="Loading preparation packet"
      />
    </div>
  );
}

function NewPreparationPacketContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [context, setContext] = useState<PreparationContext | null>(null);
  const [profiles, setProfiles] = useState<BusinessProfile[] | null>(null);
  const [profileChoice, setProfileChoice] = useState("new");
  const [draft, setDraft] = useState<PreparationIntakeDraft>(() =>
    draftFromContext(null),
  );
  const [errors, setErrors] = useState<PreparationIntakeErrors>({});
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [showSpecializedFields, setShowSpecializedFields] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const savedContext = parsePreparationContext(
      window.sessionStorage.getItem(PREPARATION_CONTEXT_STORAGE_KEY),
    );
    const hydratedContext: PreparationContext = {
      projectId: searchParams.get("projectId")?.trim() || savedContext?.projectId || "",
      address: searchParams.get("address")?.trim() || savedContext?.address || "",
      projectGoal:
        searchParams.get("goalType")?.trim() || savedContext?.projectGoal || "",
      industry: searchParams.get("industry")?.trim() || savedContext?.industry || "",
      programs: savedContext?.programs ?? [],
    };
    setContext(hydratedContext);
    setDraft(
      draftFromContext(hydratedContext, session?.user?.email?.trim() ?? ""),
    );
  }, [searchParams, session?.user?.email]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(NEW_PACKET_PATH)}`);
      return;
    }
    if (status !== "authenticated") return;

    let active = true;
    fetch("/api/business-profiles")
      .then(async (response) => {
        const body = await responseBody(response);
        if (response.status === 401) {
          router.replace(
            `/login?callbackUrl=${encodeURIComponent(NEW_PACKET_PATH)}`,
          );
          return null;
        }
        if (!response.ok) {
          throw new Error(
            responseError(body, "Could not load saved business profiles."),
          );
        }
        return extractBusinessProfiles(body);
      })
      .then((loadedProfiles) => {
        if (active && loadedProfiles) setProfiles(loadedProfiles);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProfiles([]);
        setLoadError(
          error instanceof Error
            ? error.message
            : "Could not load saved business profiles.",
        );
      });

    return () => {
      active = false;
    };
  }, [router, status]);

  // "Start another application from this Business File" links here with a
  // ?profileId; preselect that saved profile once profiles have loaded.
  useEffect(() => {
    if (!profiles) return;
    const preselect = searchParams.get("profileId")?.trim();
    if (!preselect) return;
    const profile = profiles.find((value) => value.id === preselect);
    if (!profile) return;
    setProfileChoice(preselect);
    setDraft((current) => draftFromProfile(profile, current));
  }, [profiles, searchParams]);

  const updateField = (field: keyof PreparationIntakeDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const chooseProfile = (profileId: string) => {
    setProfileChoice(profileId);
    setErrors({});
    if (profileId === "new") {
      setDraft(
        draftFromContext(context, session?.user?.email?.trim() ?? ""),
      );
      return;
    }

    const profile = profiles?.find((value) => value.id === profileId);
    if (profile) setDraft((current) => draftFromProfile(profile, current));
  };

  const chooseProgram = (programId: string) => {
    setDraft((current) =>
      selectProgramCandidate(current, programId, context?.programs ?? []),
    );
    setErrors((current) => ({ ...current, selectedProgramLabel: undefined }));
  };

  const createPacket = async (foundationOnly: boolean) => {
    const validationErrors = foundationOnly
      ? validateBusinessFileIntake(draft)
      : validatePreparationIntake(draft);
    setErrors(validationErrors);
    setSubmitError("");
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    try {
      const savedProfileId = profileChoice === "new" ? "" : profileChoice;
      const payload = foundationOnly
        ? buildFoundationPayload(draft, savedProfileId, context)
        : buildPreparationPayload(draft, savedProfileId, context);
      const packetResponse = await fetch("/api/incentive-preparation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const packetBody = await responseBody(packetResponse);
      if (!packetResponse.ok) {
        throw new Error(
          responseError(packetBody, "Could not create the preparation packet."),
        );
      }

      const packetId = extractCreatedPreparationId(packetBody);
      if (!packetId) {
        throw new Error("The new preparation packet did not include an ID.");
      }

      trackEvent("preparation_packet_created", {
        source: "preparation_intake",
        address: draft.physicalAddress || context?.address || null,
        metadata: {
          goalType: foundationOnly ? "" : draft.primaryGoal,
          hasSavedProfile: profileChoice !== "new",
          hasProgramId: foundationOnly ? false : Boolean(draft.selectedProgramId),
          foundationOnly,
        },
      });
      window.sessionStorage.removeItem(PREPARATION_CONTEXT_STORAGE_KEY);
      router.push(`/workspace/incentive-preparation/${packetId}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Could not create the preparation packet.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createPacket(false);
  };

  if (status === "loading" || (status === "authenticated" && profiles === null)) {
    return <PreparationPageLoading />;
  }

  if (status !== "authenticated") return null;

  const usingSavedProfile = profileChoice !== "new";

  return (
    <main className="min-h-screen bg-[#FAF9F6] px-4 py-10 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/workspace"
          className="mb-8 inline-flex items-center gap-2 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33]/45 hover:text-[#0C1B33]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Workspace
        </Link>

        <header className="mb-8 max-w-3xl">
          <p className="mb-3 font-mono-bureau text-[10px] uppercase tracking-[0.25em] text-[#2563EB]/70">
            Start application prep
          </p>
          <h1 className="mb-3 font-editorial text-4xl leading-tight text-[#0C1B33] sm:text-5xl">
            Application prep
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-[#0C1B33]/55">
            Your Business File holds shared business facts. This prep organizes
            application work for one likely-match program. Program administrators
            make final eligibility and award determinations.
          </p>
        </header>

        {(loadError || submitError) && (
          <div
            role="alert"
            className="mb-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {submitError || loadError}
          </div>
        )}

        <form
          onSubmit={submit}
          noValidate
          className="border border-[#0C1B33]/10 bg-white"
        >
          <section className="border-b border-[#0C1B33]/8 px-5 py-6 sm:px-7 sm:py-7">
            <div className="mb-5 flex items-start gap-3">
              <Building2
                className="mt-0.5 h-5 w-5 shrink-0 text-[#2563EB]"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-base font-semibold text-[#0C1B33]">
                  Your Business File
                </h2>
                <p className="mt-1 text-xs leading-5 text-[#0C1B33]/45">
                  Reuse a saved Business File or create one for this business.
                </p>
              </div>
            </div>

            <div className="max-w-xl">
              <FieldLabel htmlFor="business-profile">Saved Business File</FieldLabel>
              <select
                id="business-profile"
                value={profileChoice}
                onChange={(event) => chooseProfile(event.target.value)}
                className={inputClassName}
              >
                <option value="new">Create a new Business File</option>
                {(profiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.legalBusinessName || "Saved business"}
                    {profile.physicalAddress ? ` - ${profile.physicalAddress}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="border-b border-[#0C1B33]/8 px-5 py-6 sm:px-7 sm:py-7">
            <SectionHeading
              title="Business File facts"
              description="Entered once, reused in every application you prepare."
            />
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 md:grid-cols-2">
              <TextField
                id="legal-business-name"
                label="Legal business name"
                value={draft.legalBusinessName}
                onChange={(value) => updateField("legalBusinessName", value)}
                error={errors.legalBusinessName}
                autoComplete="organization"
                required
                disabled={usingSavedProfile}
              />
              <TextField
                id="physical-address"
                label="Physical or project address"
                value={draft.physicalAddress}
                onChange={(value) => updateField("physicalAddress", value)}
                error={errors.physicalAddress}
                autoComplete="street-address"
                required
                disabled={usingSavedProfile}
              />
              <TextField
                id="contact-name"
                label="Contact name"
                value={draft.contactName}
                onChange={(value) => updateField("contactName", value)}
                error={errors.contactName}
                autoComplete="name"
                required
                disabled={usingSavedProfile}
              />
              <TextField
                id="contact-email"
                label="Contact email"
                value={draft.contactEmail}
                onChange={(value) => updateField("contactEmail", value)}
                error={errors.contactEmail}
                autoComplete="email"
                type="email"
                required
                disabled={usingSavedProfile}
              />
              <div>
                <FieldLabel htmlFor="primary-goal" required>
                  Primary goal
                </FieldLabel>
                <select
                  id="primary-goal"
                  value={draft.primaryGoal}
                  onChange={(event) => updateField("primaryGoal", event.target.value)}
                  aria-invalid={Boolean(errors.primaryGoal)}
                  aria-describedby={errors.primaryGoal ? "primary-goal-error" : undefined}
                  className={inputClassName}
                >
                  <option value="">Select the main goal</option>
                  {GOAL_OPTIONS.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.label}
                    </option>
                  ))}
                </select>
                <FieldError id="primary-goal-error" message={errors.primaryGoal} />
              </div>

              <div>
                <FieldLabel htmlFor="likely-match-program" required>
                  Selected likely-match program
                </FieldLabel>
                {context?.programs.length ? (
                  <select
                    id="likely-match-program"
                    value={draft.selectedProgramId}
                    onChange={(event) => chooseProgram(event.target.value)}
                    aria-invalid={Boolean(errors.selectedProgramLabel)}
                    aria-describedby={
                      errors.selectedProgramLabel
                        ? "likely-match-program-error"
                        : undefined
                    }
                    className={inputClassName}
                  >
                    <option value="">Select a likely match</option>
                    {context.programs.map((program) => (
                      <option key={program.programId} value={program.programId}>
                        {program.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="likely-match-program"
                    value={draft.selectedProgramLabel}
                    onChange={(event) => {
                      updateField("selectedProgramLabel", event.target.value);
                      updateField("selectedProgramId", "");
                    }}
                    placeholder="Program name"
                    aria-invalid={Boolean(errors.selectedProgramLabel)}
                    aria-describedby={
                      errors.selectedProgramLabel
                        ? "likely-match-program-error"
                        : undefined
                    }
                    className={inputClassName}
                  />
                )}
                <FieldError
                  id="likely-match-program-error"
                  message={errors.selectedProgramLabel}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSpecializedFields((current) => !current)}
              aria-expanded={showSpecializedFields}
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#2563EB] hover:text-[#1d4ed8]"
            >
              {showSpecializedFields ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
              Optional business details
            </button>

            {showSpecializedFields && (
              <div className="mt-5 grid grid-cols-1 gap-x-5 gap-y-5 border-t border-[#0C1B33]/8 pt-5 md:grid-cols-2">
                <TextField
                  id="dba-name"
                  label="Doing business as"
                  value={draft.dbaName}
                  onChange={(value) => updateField("dbaName", value)}
                  autoComplete="organization"
                  disabled={usingSavedProfile}
                />
                <TextField
                  id="contact-phone"
                  label="Contact phone"
                  value={draft.contactPhone}
                  onChange={(value) => updateField("contactPhone", value)}
                  autoComplete="tel"
                  type="tel"
                  disabled={usingSavedProfile}
                />
                <TextField
                  id="industry"
                  label="Industry"
                  value={draft.industry}
                  onChange={(value) => updateField("industry", value)}
                  disabled={usingSavedProfile}
                />
                <TextField
                  id="entity-type"
                  label="Entity type"
                  value={draft.entityType}
                  onChange={(value) => updateField("entityType", value)}
                  placeholder="Example: LLC"
                  disabled={usingSavedProfile}
                />
                <TextField
                  id="formation-date"
                  label="Formation date"
                  value={draft.formationDate}
                  onChange={(value) => updateField("formationDate", value)}
                  type="date"
                  disabled={usingSavedProfile}
                />
                <TextField
                  id="employee-count"
                  label="Employee count"
                  value={draft.employeeCount}
                  onChange={(value) => updateField("employeeCount", value)}
                  inputMode="numeric"
                  disabled={usingSavedProfile}
                />
              </div>
            )}
          </section>

          <footer className="flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div className="flex max-w-2xl items-start gap-3">
              <FilePlus2
                className="mt-0.5 h-4 w-4 shrink-0 text-[#0C1B33]/35"
                aria-hidden="true"
              />
              <p className="text-xs leading-5 text-[#0C1B33]/45">
                This packet supports application preparation and does not
                certify eligibility or an award. Final determinations belong
                to the program administrator.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => void createPacket(true)}
                disabled={submitting}
                className="inline-flex min-h-11 items-center justify-center gap-2 border border-[#0C1B33]/25 px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-[#0C1B33] transition-colors hover:bg-[#0C1B33]/[0.04] disabled:cursor-wait disabled:opacity-60"
              >
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                Start Business File only
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-11 items-center justify-center gap-2 bg-[#0C1B33] px-5 py-3 font-mono-bureau text-[10px] uppercase tracking-[0.15em] text-white transition-colors hover:bg-[#1E3054] disabled:cursor-wait disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                )}
                Start prep
              </button>
            </div>
          </footer>
        </form>
      </div>
    </main>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold text-[#0C1B33]">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[#0C1B33]/45">{description}</p>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
  required = false,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-medium text-[#0C1B33]/70"
    >
      {children}
      {required && <span className="ml-1 text-red-600">*</span>}
    </label>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-xs text-red-600">
      {message}
    </p>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  required = false,
  type = "text",
  autoComplete,
  inputMode,
  placeholder,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  disabled?: boolean;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={inputClassName}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}
