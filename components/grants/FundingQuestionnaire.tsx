"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import {
  applicantSchema,
  fundingLabels,
  type Applicant,
  type GrantRecord,
} from "@/lib/grants/model";

import { BusinessClassification } from "./BusinessClassification";
import {
  businessStructures,
  spaceArrangements,
} from "@/lib/grants/classification";

const steps = ["Business", "Project", "Funding", "Review"];
const costOptions: Record<string, string> = {
  roofing: "Roofing",
  plumbing: "Plumbing",
  "flood control": "Flood prevention / remediation",
  rehabilitation: "Building rehabilitation",
  equipment: "Equipment",
  accessibility: "Accessibility",
  "working capital": "Working capital",
  marketing: "Marketing",
  training: "Staff training",
  "energy efficiency": "Energy efficiency",
};
const chicagoToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const csv = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];

export function FundingQuestionnaire({
  record,
  ownerId,
  onClose,
  onSave,
}: {
  record?: GrantRecord<Applicant>;
  ownerId: string;
  onClose: () => void;
  onSave: (data: Applicant) => Promise<void>;
}) {
  const [data, setData] = useState<Applicant>(() => ({
    ...applicantSchema.parse(
      record
        ? {
            ...record.data,
            businessType: record.data.businessType || "Unknown",
            industry: record.data.industry || "Unknown",
            primaryGoal:
              record.data.primaryGoal || record.data.project.slice(0, 500),
            intakeDate: null,
          }
        : {
            name: "New business",
            role: "unknown",
            entity: "unknown",
            stage: "unknown",
            ownerId,
            fundingTypes: ["grant", "reimbursement", "tax_benefit", "in_kind"],
          },
    ),
    intakeDate: record?.data.intakeDate || chicagoToday(),
  }));
  const [businessName, setBusinessName] = useState(record?.data.name || "");
  const [step, setStep] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
    scroller.current?.scrollTo({ top: 0 });
  }, [step]);
  const set = <K extends keyof Applicant>(key: K, value: Applicant[K]) =>
    setData((d) => ({ ...d, [key]: value }));
  const field = (
    key:
      | "businessType"
      | "industry"
      | "primaryGoal"
      | "address"
      | "budget"
      | "factsSource"
      | "project",
    label: string,
    placeholder: string,
    required = false,
    area = false,
  ) => (
    <label className="grant-question-field">
      <span>
        {label}
        {required && " *"}
      </span>
      {area ? (
        <textarea
          aria-label={label}
          rows={3}
          value={data[key]}
          onChange={(e) => set(key, e.target.value)}
          placeholder={placeholder}
          required={required}
          maxLength={key === "primaryGoal" ? 500 : 4000}
        />
      ) : (
        <input
          aria-label={label}
          value={data[key]}
          onChange={(e) => set(key, e.target.value)}
          placeholder={placeholder}
          required={required}
          maxLength={key === "address" ? 400 : 200}
        />
      )}
    </label>
  );
  const choose = (
    key:
      "role" | "entity" | "stage" | "reimbursementReady" | "spaceArrangement",
    label: string,
    choices: Record<string, string>,
  ) => (
    <fieldset className="grant-question-field">
      <legend>{label}</legend>
      <div className="grant-choice-grid">
        {Object.entries(choices).map(([value, title]) => (
          <label key={value} className="grant-choice">
            <input
              type="radio"
              name={`intake-${key}`}
              value={value}
              checked={data[key] === value}
              onChange={() => set(key, value as Applicant[typeof key])}
            />
            <span>{title}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const submit = async () => {
    setError("");
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    const parsed = applicantSchema.safeParse({ ...data, name: businessName });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" · "));
      return;
    }
    if (
      ![businessName, data.primaryGoal].every((v) => v.trim()) ||
      !data.intakeDate
    ) {
      setError(
        "Complete business name, primary goal and intake date before generating a shortlist. Unconfirmed classification will remain a follow-up.",
      );
      return;
    }
    if (!data.fundingTypes.length) {
      setError("Choose at least one funding type in step 3.");
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save this profile. Your answers are still here.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-[#0C1B33]/55 backdrop-blur-sm" />
        <Dialog.Content className="grant-questionnaire fixed left-1/2 top-1/2 z-[101] flex max-h-[92dvh] w-[min(820px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="grant-questionnaire-header">
            <div>
              <p className="grant-eyebrow">GRANTS MATCHMAKER</p>
              <Dialog.Title className="text-xl font-semibold">
                Find a focused funding shortlist
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-slate-500">
                Four steps. Save the business profile and find up to five
                relevant opportunities.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close questionnaire" disabled={busy}>
              <X size={20} />
            </Dialog.Close>
          </div>
          <ol
            className="grant-question-steps"
            aria-label="Questionnaire progress"
          >
            {steps.map((s, i) => (
              <li
                key={s}
                aria-current={step === i ? "step" : undefined}
                className={i <= step ? "reached" : ""}
              >
                <span>{i < step ? <Check size={13} /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div ref={scroller} className="grant-questionnaire-body">
              <h2
                ref={heading}
                tabIndex={-1}
                className="mb-2 text-lg font-semibold outline-none"
              >
                {
                  [
                    "Tell us about the business",
                    "What is the primary goal?",
                    "What funding can work?",
                    "Review the business profile",
                  ][step]
                }
              </h2>
              <p className="mb-6 text-sm text-slate-500">
                {
                  [
                    "Use Unknown when a fact still needs confirmation. Fields marked * are required.",
                    "The location and planned expenses help us narrow the list. Add only confirmed area or zone tags.",
                    "Choose the forms of support the business would consider. Timing and cash needs stay visible during review.",
                    "These answers are saved for the team. You can return to the questionnaire as the project changes.",
                  ][step]
                }
              </p>
              {step === 0 && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grant-question-field">
                      <span>Business name *</span>
                      <input
                        aria-label="Business name"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        required
                        maxLength={200}
                        placeholder="Business or project name"
                      />
                    </label>
                    <label className="grant-question-field">
                      <span>Intake date *</span>
                      <input
                        type="date"
                        aria-label="Intake date"
                        value={data.intakeDate || ""}
                        onChange={(e) =>
                          set("intakeDate", e.target.value || null)
                        }
                        required
                      />
                    </label>
                    <BusinessClassification
                      data={data}
                      onChange={(fields) =>
                        setData((d) => ({ ...d, ...fields }))
                      }
                    />
                  </div>
                  {choose("role", "How is the applicant involved?", {
                    landlord: "Property owner / landlord",
                    operator: "Business operator",
                    unknown: "Not confirmed",
                  })}
                  {choose(
                    "spaceArrangement",
                    "What is the arrangement for the project space?",
                    spaceArrangements,
                  )}
                  {choose("entity", "Which applicant category is confirmed?", {
                    for_profit: "For-profit business",
                    nonprofit: "Nonprofit",
                    individual: "Individual",
                    unknown: "Not confirmed",
                  })}
                  {choose("stage", "Where is the business today?", {
                    pre_opening: "Preparing to open",
                    operating: "Already operating",
                    unknown: "Not confirmed",
                  })}
                </div>
              )}
              {step === 1 && (
                <div className="space-y-5">
                  {field(
                    "primaryGoal",
                    "Primary goal",
                    "e.g. Repair the roof and stop basement flooding",
                    true,
                    true,
                  )}
                  {field(
                    "project",
                    "Project details",
                    "Scope, constraints and what success would look like",
                    false,
                    true,
                  )}
                  <fieldset className="grant-question-field">
                    <legend>What expenses need support?</legend>
                    <div className="grant-choice-grid">
                      {Object.entries(costOptions).map(([value, label]) => (
                        <label key={value} className="grant-choice">
                          <input
                            type="checkbox"
                            checked={data.costs.includes(value)}
                            onChange={(e) =>
                              set(
                                "costs",
                                e.target.checked
                                  ? [...data.costs, value]
                                  : data.costs.filter((v) => v !== value),
                              )
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">
                      Choose all that apply. Unknown costs remain a follow-up
                      question.
                    </p>
                  </fieldset>
                  <label className="grant-question-field">
                    <span>Other expense categories</span>
                    <input
                      aria-label="Other expense categories"
                      defaultValue={data.costs
                        .filter((c) => !costOptions[c])
                        .join(", ")}
                      onBlur={(e) =>
                        set("costs", [
                          ...data.costs.filter((c) => Boolean(costOptions[c])),
                          ...csv(e.target.value).filter((c) => !costOptions[c]),
                        ])
                      }
                      placeholder="Additional categories, separated by commas"
                    />
                  </label>
                  {field(
                    "address",
                    "Project address",
                    "Street address, city and ZIP, if known",
                  )}
                  <label className="grant-question-field">
                    <span>Confirmed locations / zones</span>
                    <input
                      aria-label="Confirmed locations / zones"
                      defaultValue={data.geography.join(", ")}
                      onBlur={(e) => set("geography", csv(e.target.value))}
                      placeholder="e.g. Chicago, Avalon Park/South Shore TIF"
                    />
                    <small>
                      Use Explorer to verify zones. An address alone does not
                      establish geographic eligibility.
                    </small>
                  </label>
                </div>
              )}
              {step === 2 && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field(
                      "budget",
                      "Project budget / funding need",
                      "e.g. $80,000 roof and plumbing project",
                    )}
                    <label className="grant-question-field">
                      <span>Target funding date (optional)</span>
                      <input
                        type="date"
                        aria-label="Target funding date"
                        value={data.targetDate || ""}
                        onChange={(e) =>
                          set("targetDate", e.target.value || null)
                        }
                      />
                    </label>
                  </div>
                  <fieldset className="grant-question-field">
                    <legend>What types of support should we include?</legend>
                    <div className="grant-choice-grid">
                      {Object.entries(fundingLabels).map(([value, label]) => (
                        <label key={value} className="grant-choice">
                          <input
                            type="checkbox"
                            checked={data.fundingTypes.includes(
                              value as Applicant["fundingTypes"][number],
                            )}
                            onChange={(e) =>
                              set(
                                "fundingTypes",
                                e.target.checked
                                  ? [
                                      ...data.fundingTypes,
                                      value as Applicant["fundingTypes"][number],
                                    ]
                                  : data.fundingTypes.filter(
                                      (v) => v !== value,
                                    ),
                              )
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {data.fundingTypes.includes("reimbursement") &&
                    choose(
                      "reimbursementReady",
                      "Can the business pay eligible costs before reimbursement?",
                      {
                        yes: "Yes, upfront funding is available",
                        no: "No, funding is needed first",
                        unknown: "Needs confirmation",
                      },
                    )}
                  <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                    An application deadline does not tell us when money will
                    arrive. The shortlist flags payment timing and required
                    contributions for staff review.
                  </p>
                </div>
              )}
              {step === 3 && (
                <div className="space-y-5">
                  <dl className="grant-intake-summary">
                    {[
                      ["Business name", businessName],
                      [
                        "Business structure",
                        businessStructures[data.businessStructure],
                      ],
                      [
                        "Business type",
                        data.naicsCode
                          ? `${data.naicsCode} — ${data.businessType}`
                          : "Not confirmed",
                      ],
                      [
                        "Business industry",
                        data.industryCode
                          ? `${data.industryCode} — ${data.industry}`
                          : "Not confirmed",
                      ],
                      [
                        "Space arrangement",
                        spaceArrangements[data.spaceArrangement],
                      ],
                      ["Intake date", data.intakeDate],
                      ["Primary goal", data.primaryGoal],
                      [
                        "Applicant",
                        `${data.role} · ${data.entity} · ${data.stage}`.replaceAll(
                          "_",
                          " ",
                        ),
                      ],
                      ["Project location", data.address || "Not confirmed"],
                      [
                        "Confirmed zones",
                        data.geography.join(", ") || "Not confirmed",
                      ],
                      ["Expenses", data.costs.join(", ") || "Not confirmed"],
                      ["Budget", data.budget || "Not confirmed"],
                      ["Target funding date", data.targetDate || "Not set"],
                      [
                        "Support types",
                        data.fundingTypes
                          .map((v) => fundingLabels[v])
                          .join(", ") || "None selected",
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value || "Needs confirmation"}</dd>
                      </div>
                    ))}
                  </dl>
                  {field(
                    "factsSource",
                    "Source / confirmation note",
                    "e.g. Owner intake on September 11; legal structure and taxes still to verify",
                    false,
                    true,
                  )}
                  <p className="text-xs text-slate-500">
                    The shortlist uses recorded criteria. Unknown information
                    stays visible, and staff review is required before
                    recommending an application.
                  </p>
                </div>
              )}
              {error && (
                <p role="alert" className="grant-alert error mt-4">
                  {error}
                </p>
              )}
            </div>
            <div className="grant-questionnaire-footer">
              <button
                type="button"
                className="grant-button"
                disabled={busy}
                onClick={() => {
                  if (step) {
                    setError("");
                    setStep(step - 1);
                  } else onClose();
                }}
              >
                <ArrowLeft size={15} />
                {step ? "Back" : "Cancel"}
              </button>
              <span className="text-xs text-slate-500">
                Step {step + 1} of 4
              </span>
              <button
                className="grant-button primary"
                disabled={busy}
                type="submit"
              >
                {busy
                  ? "Saving…"
                  : step === 3
                    ? "Save & generate shortlist"
                    : "Continue"}
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
