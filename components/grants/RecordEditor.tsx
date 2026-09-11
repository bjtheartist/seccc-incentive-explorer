"use client";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { instantFromLocal, localTime } from "@/lib/grants/time";
import {
  cadenceLabels,
  fundingLabels,
  reviewLabels,
  schemas,
  type Resource,
  type GrantRecord,
  type WorkspaceData,
} from "@/lib/grants/model";

type FormData = Record<string, unknown>;
export interface EditorTarget {
  resource: Resource;
  record?: GrantRecord<unknown>;
  defaults?: FormData;
}
const options = (values: readonly string[]) =>
  Object.fromEntries(values.map((v) => [v, v.replaceAll("_", " ")]));
const initial = (target: EditorTarget): FormData => {
  if (target.record) return structuredClone(target.record.data) as FormData;
  const common = { ownerId: null, notes: "", tags: [] };
  const data: Record<Resource, FormData> = {
    programs: {
      name: "",
      sponsor: "",
      sponsorType: "public",
      fundingType: "grant",
      cadence: "unknown",
      sourceUrl: "",
      description: "",
      archived: false,
    },
    rounds: {
      name: "",
      programId: "",
      availability: "unknown",
      opensAt: null,
      closesAt: null,
      timezone: "America/Chicago",
      amount: "Amount to verify",
      evidenceUrl: "",
      evidence: "",
      review: "unverified",
      verifiedAt: null,
      nextReviewAt: null,
      rules: {
        roles: [],
        entities: [],
        stages: [],
        geography: [],
        costs: [],
        exclusions: "",
        requirements: "",
      },
    },
    applicants: {
      name: "",
      role: "unknown",
      entity: "unknown",
      stage: "unknown",
      geography: [],
      industry: "",
      address: "",
      project: "",
      costs: [],
      budget: "",
      factsSource: "",
      archived: false,
    },
    sources: {
      name: "",
      url: "",
      kind: "directory",
      programId: null,
      intervalDays: 7,
      enabled: true,
    },
    matches: {
      applicantId: "",
      roundId: "",
      status: "candidate",
      rationale: "",
      questions: "",
      nextAction: "",
      roundVersion: 1,
      applicantVersion: 1,
    },
  };
  return { ...common, ...data[target.resource], ...target.defaults };
};
export function RecordEditor({
  target,
  workspace,
  onClose,
  onSave,
}: {
  target: EditorTarget;
  workspace: WorkspaceData;
  onClose: () => void;
  onSave: (data: FormData) => Promise<void>;
}) {
  const [data, setData] = useState(() => initial(target));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: unknown) =>
    setData((d) => ({ ...d, [key]: value }));
  const rules = (data.rules || {}) as FormData;
  const setRule = (key: string, value: unknown) =>
    set("rules", { ...rules, [key]: value });
  const field = (
    key: string,
    label: string,
    type: "text" | "area" | "tags" | "date" = "text",
    help?: string,
  ) => (
    <Field
      key={`${key}-${type === "date" ? data.timezone : ""}`}
      timezone={String(data.timezone || "America/Chicago")}
      label={label}
      value={data[key]}
      type={type}
      help={help}
      onChange={(v) => set(key, v)}
    />
  );
  const select = (
    key: string,
    label: string,
    choices: Record<string, string>,
    blank?: string,
  ) => (
    <Select
      key={key}
      label={label}
      value={String(data[key] || "")}
      choices={choices}
      blank={blank}
      onChange={(v) => set(key, v || null)}
    />
  );
  const resourceLabel = {
    programs: "program",
    rounds: "application round",
    applicants: "business / project",
    sources: "monitored source",
    matches: "match review",
  }[target.resource];
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-[#0C1B33]/55 backdrop-blur-sm" />
        <Dialog.Content className="grant-dialog fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold text-[#0C1B33]">
                {target.record ? "Update" : "Add"} {resourceLabel}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                Saved to the shared team database with an edit history.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close editor" disabled={busy}>
              <X size={20} />
            </Dialog.Close>
          </div>
          <form
            className="mt-6 space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              const result = schemas[target.resource].safeParse(data);
              if (!result.success) {
                setError(
                  result.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join(" · "),
                );
                return;
              }
              setBusy(true);
              try {
                await onSave(result.data as FormData);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {target.resource !== "matches" && field("name", "Name")}
              {target.resource === "programs" && (
                <>
                  {field("sponsor", "Funder / sponsor")}
                  {select(
                    "sponsorType",
                    "Funder category",
                    options([
                      "public",
                      "philanthropic",
                      "corporate",
                      "community",
                    ]),
                  )}
                  {select("fundingType", "Funding form", fundingLabels)}
                  {select("cadence", "Program timing", cadenceLabels)}
                  {field("sourceUrl", "Official program URL")}
                </>
              )}
              {target.resource === "rounds" && (
                <>
                  {select(
                    "programId",
                    "Program",
                    Object.fromEntries(
                      workspace.programs.map((p) => [p.id, p.data.name]),
                    ),
                    "Choose program",
                  )}
                  {select(
                    "availability",
                    "Published availability",
                    options([
                      "unknown",
                      "announced",
                      "open",
                      "rolling",
                      "closed",
                    ]),
                  )}
                  {field("amount", "Award amount / reimbursement terms")}
                  {field("opensAt", "Opening date and time", "date")}
                  {field("closesAt", "Deadline date and time", "date")}
                  {select("timezone", "Deadline timezone", {
                    "America/Chicago": "Central (Chicago)",
                    "America/New_York": "Eastern",
                    "America/Denver": "Mountain",
                    "America/Los_Angeles": "Pacific",
                    UTC: "UTC",
                  })}
                  {select("review", "Verification status", reviewLabels)}
                  {field("verifiedAt", "Verified at", "date")}
                  {field("nextReviewAt", "Review again by", "date")}
                  {field("evidenceUrl", "Evidence / application URL")}
                </>
              )}
              {target.resource === "applicants" && (
                <>
                  {select(
                    "role",
                    "Applicant role",
                    options(["unknown", "landlord", "operator", "tenant"]),
                  )}
                  {select(
                    "entity",
                    "Legal entity",
                    options([
                      "unknown",
                      "for_profit",
                      "nonprofit",
                      "individual",
                    ]),
                  )}
                  {select(
                    "stage",
                    "Business stage",
                    options(["unknown", "pre_opening", "operating"]),
                  )}
                  {field("businessType", "Business type")}
                  {field("industry", "Business industry")}
                  {field("primaryGoal", "Primary goal", "area")}
                  {field("address", "Project address / PINs")}
                  {field("budget", "Project budget / cash readiness")}
                  {field(
                    "geography",
                    "Verified geographic tags",
                    "tags",
                    "Comma-separated; use confirmed places or zones",
                  )}
                  {field(
                    "costs",
                    "Project cost categories",
                    "tags",
                    "e.g. roofing, plumbing, equipment",
                  )}
                </>
              )}
              {target.resource === "sources" && (
                <>
                  {field("url", "Public HTTPS source URL")}
                  {select("kind", "Scan purpose", {
                    directory: "Discover links from a funding directory",
                    program: "Monitor an existing program page",
                  })}
                  {select(
                    "programId",
                    "Linked program",
                    Object.fromEntries(
                      workspace.programs.map((p) => [p.id, p.data.name]),
                    ),
                    "No linked program",
                  )}
                  <label className="grant-field">
                    Check every (days)
                    <input
                      type="number"
                      min="1"
                      max="90"
                      value={Number(data.intervalDays)}
                      onChange={(e) =>
                        set("intervalDays", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="grant-field flex-row! items-center">
                    <input
                      type="checkbox"
                      checked={Boolean(data.enabled)}
                      onChange={(e) => set("enabled", e.target.checked)}
                    />
                    Monitoring enabled
                  </label>
                </>
              )}
              {target.resource === "matches" && (
                <>
                  <div className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-sm">
                    {
                      workspace.applicants.find(
                        (a) => a.id === data.applicantId,
                      )?.data.name
                    }{" "}
                    →{" "}
                    {
                      workspace.rounds.find((r) => r.id === data.roundId)?.data
                        .name
                    }
                  </div>
                  {select(
                    "status",
                    "Staff decision",
                    options([
                      "candidate",
                      "needs_information",
                      "ready_for_review",
                      "approved",
                      "not_eligible",
                      "archived",
                    ]),
                  )}
                </>
              )}
              {select(
                "ownerId",
                "Responsible team member",
                Object.fromEntries(
                  workspace.members.map((m) => [m.userId, m.name]),
                ),
                "Unassigned",
              )}
              {field(
                "tags",
                "Tags",
                "tags",
                "Comma-separated categories for filtering",
              )}
            </div>
            {target.resource === "programs" &&
              field("description", "Program purpose", "area")}
            {target.resource === "rounds" && (
              <>
                <div className="rounded-xl border border-slate-200 p-4">
                  <h3 className="mb-3 font-semibold">
                    Recorded screening criteria
                  </h3>
                  <p className="mb-4 text-xs text-slate-500">
                    Empty criteria remain unknown. Use “any” only when supported
                    by the program rules.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      "roles",
                      "entities",
                      "stages",
                      "industries",
                      "businessTypes",
                      "geography",
                      "costs",
                    ].map((k) => (
                      <Field
                        key={k}
                        type="tags"
                        label={
                          k === "roles"
                            ? "Roles: landlord, operator, tenant, any"
                            : k === "entities"
                              ? "Entities: for_profit, nonprofit, individual, any"
                              : k === "stages"
                                ? "Stages: pre_opening, operating, any"
                                : k === "businessTypes"
                                  ? "Business types (or any)"
                                  : k === "industries"
                                    ? "Industries (or any)"
                                    : k
                        }
                        value={rules[k]}
                        onChange={(v) => setRule(k, v)}
                      />
                    ))}
                  </div>
                  <div className="mt-4 space-y-4">
                    <Field
                      type="area"
                      label="Exclusions / non-eligible costs"
                      value={rules.exclusions}
                      onChange={(v) => setRule("exclusions", v)}
                    />
                    <Field
                      type="area"
                      label="Other requirements, cash needs and stacking rules"
                      value={rules.requirements}
                      onChange={(v) => setRule("requirements", v)}
                    />
                  </div>
                </div>
                {field(
                  "evidence",
                  "Evidence supporting dates, amounts and rules",
                  "area",
                  "Summarize the exact source and date checked. Scanning alone is not verification.",
                )}
              </>
            )}
            {target.resource === "applicants" && (
              <>
                {field("project", "Project / funding need", "area")}
                {field(
                  "factsSource",
                  "Source of applicant facts and unresolved details",
                  "area",
                )}
              </>
            )}
            {target.resource === "matches" && (
              <>
                {field(
                  "rationale",
                  "Why this fits / reasons to rule it out",
                  "area",
                )}
                {field("questions", "Outstanding questions", "area")}
                {field("nextAction", "Next action", "area")}
                <p className="text-xs text-slate-500">
                  Approval records a staff review. It does not send a message or
                  confirm eligibility with the funder.
                </p>
              </>
            )}
            {field(
              "notes",
              target.resource === "matches"
                ? "Review notes / resolution of screening questions"
                : "Team notes",
              "area",
            )}
            {(target.resource === "programs" ||
              target.resource === "applicants") && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(data.archived)}
                  onChange={(e) => set("archived", e.target.checked)}
                />
                Archive this record
              </label>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                className="grant-button"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button className="grant-button primary" disabled={busy}>
                {busy ? "Saving…" : "Save to workspace"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  help,
  timezone = "America/Chicago",
}: {
  timezone?: string;
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  type?: "text" | "area" | "tags" | "date";
  help?: string;
}) {
  const string =
    type === "tags"
      ? Array.isArray(value)
        ? value.join(", ")
        : String(value || "")
      : type === "date" && value
        ? localTime(String(value), timezone)
        : String(value || "");
  // Keep tag text local while typing so a trailing comma does not disappear.
  const [draft, setDraft] = useState(string);
  const change = (v: string) => {
    setDraft(v);
    onChange(
      type === "tags"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : type === "date"
          ? instantFromLocal(v, timezone)
          : v,
    );
  };
  return (
    <label className="grant-field">
      {label}
      {type === "area" ? (
        <textarea
          aria-label={label}
          rows={3}
          value={draft}
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          type={type === "date" ? "datetime-local" : "text"}
          value={draft}
          onChange={(e) => {
            try {
              change(e.target.value);
              e.target.setCustomValidity("");
            } catch {
              e.target.setCustomValidity(
                "Choose a valid local time outside the daylight-saving gap.",
              );
            }
          }}
        />
      )}
      {(help || type === "date") && (
        <span className="text-xs font-normal text-slate-500">
          {help || `Time in ${timezone}. Leave blank when unconfirmed.`}
        </span>
      )}
    </label>
  );
}
function Select({
  label,
  value,
  choices,
  blank,
  onChange,
}: {
  label: string;
  value: string;
  choices: Record<string, string>;
  blank?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grant-field">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {blank && <option value="">{blank}</option>}
        {Object.entries(choices).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
