"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Inbox,
  Library,
  Users,
  Radio,
  History,
  LayoutDashboard,
  Download,
  ChevronRight,
} from "lucide-react";
import { ConciergePageContextBridge } from "@/components/concierge/SiteConciergeProvider";
import { RecordEditor, type EditorTarget } from "./RecordEditor";
import { FundingQuestionnaire } from "./FundingQuestionnaire";
import { GrantShortlist } from "./GrantShortlist";
import {
  cadenceLabels,
  fundingLabels,
  roundState,
  screenMatch,
  matchNeedsReview,
  type WorkspaceData,
  type GrantRecord,
  type Round,
  type Match,
  type Program,
  type Applicant,
} from "@/lib/grants/model";

type View =
  "overview" | "opportunities" | "queue" | "businesses" | "sources" | "team";
const views = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "opportunities", label: "Opportunities", icon: Library },
  { id: "queue", label: "Review queue", icon: Inbox },
  { id: "businesses", label: "Businesses & matches", icon: Users },
  { id: "sources", label: "Sources", icon: Radio },
  { id: "team", label: "Team & history", icon: History },
] as const;
const date = (value: string | null, timezone = "America/Chicago") =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value))
    : "Not confirmed";
const deadline = (r: Round) =>
  r.closesAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: r.timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(r.closesAt)) + ` · ${r.timezone}`
    : r.availability === "rolling"
      ? "Rolling intake"
      : "No confirmed deadline";
const human = (v: string) => v.replaceAll("_", " ");
async function mutate(resource: string, body: unknown) {
  const res = await fetch(`/api/admin/grants/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function GrantsWorkspace({ initial }: { initial: WorkspaceData }) {
  const [workspace, setWorkspace] = useState(initial);
  const [view, setView] = useState<View>("overview");
  const [search, setSearch] = useState("");
  const [cadence, setCadence] = useState("");
  const [funding, setFunding] = useState("");
  const [status, setStatus] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [questionnaire, setQuestionnaire] = useState<{
    record?: GrantRecord<Applicant>;
  } | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [activeProgram, setActiveProgram] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (activeProgram) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      detailRef.current?.focus({ preventScroll: true });
    }
  }, [activeProgram]);
  const [activeApplicant, setActiveApplicant] = useState(
    initial.applicants.find((a) => !a.data.archived)?.id || "",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const now = new Date(clock);
  const canEdit = workspace.member.role !== "viewer";
  const name = (id: string | null) =>
    workspace.members.find((m) => m.userId === id)?.name ||
    (id === "scanner" ? "Source scanner" : id ? "Team member" : "Unassigned");
  const activePrograms = workspace.programs.filter((p) => !p.data.archived);
  const activeRounds = workspace.rounds.filter(
    (r) =>
      activePrograms.some((p) => p.id === r.data.programId) &&
      r.data.review !== "archived",
  );
  const needsReview = activeRounds.filter(
    (r) => roundState(r.data, now) === "unverified",
  );
  const closing = activeRounds
    .filter(
      (r) =>
        ["open", "rolling"].includes(roundState(r.data, now)) &&
        r.data.closesAt &&
        Date.parse(r.data.closesAt) - clock <= 30 * 86400_000,
    )
    .sort(
      (a, b) => Date.parse(a.data.closesAt!) - Date.parse(b.data.closesAt!),
    );
  const selectedProgram = workspace.programs.find(
    (p) => p.id === activeProgram,
  );
  const applicant = workspace.applicants.find(
    (a) => a.id === activeApplicant && !a.data.archived,
  );
  const refresh = async () => {
    const res = await fetch("/api/admin/grants/workspace", {
      cache: "no-store",
    });
    if (!res.ok)
      throw new Error((await res.json()).error || "Could not refresh");
    setWorkspace(await res.json());
    setClock(Date.now());
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete action");
    } finally {
      setBusy(false);
    }
  };
  const openRound = (r?: GrantRecord<Round>, p?: GrantRecord<Program>) =>
    setEditor({
      resource: "rounds",
      record: r,
      defaults: {
        programId: p?.id || activeProgram || "",
        evidenceUrl: p?.data.sourceUrl || selectedProgram?.data.sourceUrl || "",
        ownerId: workspace.member.userId,
      },
    });
  const programName = (id: string) =>
    workspace.programs.find((p) => p.id === id)?.data.name || "Program";
  const visiblePrograms = workspace.programs.filter(
    (p) =>
      (showArchived || !p.data.archived) &&
      (!cadence || p.data.cadence === cadence) &&
      (!funding || p.data.fundingType === funding) &&
      (!search ||
        [p.data.name, p.data.sponsor, p.data.description, ...p.data.tags]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!status ||
        workspace.rounds.some(
          (r) =>
            r.data.programId === p.id && roundState(r.data, now) === status,
        )),
  );
  const editMatch = (r: GrantRecord<Round>, m?: GrantRecord<Match>) => {
    if (!applicant) return;
    const s = screenMatch(applicant.data, r.data, now);
    setEditor({
      resource: "matches",
      record: m
        ? {
            ...m,
            data: {
              ...m.data,
              applicantVersion: applicant.version,
              roundVersion: r.version,
            },
          }
        : undefined,
      defaults: {
        applicantId: applicant.id,
        roundId: r.id,
        applicantVersion: applicant.version,
        roundVersion: r.version,
        status: s.result,
        rationale: [...s.reasons, ...s.exclusions].join("\n"),
        questions: s.gaps.join("\n"),
        ownerId: workspace.member.userId,
      },
    });
  };
  return (
    <div className="grants-workspace">
      <ConciergePageContextBridge
        route="/admin/grants"
        pageLabel="Internal grants workspace"
        suppressed
      />
      <aside className="grant-sidebar">
        <Link href="/" className="grant-wordmark">
          CHICAGO
          <br />
          <span>INCENTIVE EXPLORER</span>
        </Link>
        <div className="grant-space-label">
          <ShieldCheck size={14} /> INTERNAL WORKSPACE
        </div>
        <nav aria-label="Grants workspace">
          {views.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? "active" : ""}
              aria-current={view === v.id ? "page" : undefined}
              onClick={() => {
                setView(v.id);
                setActiveProgram(null);
              }}
            >
              <v.icon size={17} />
              {v.label}
              {v.id === "queue" && workspace.findings.length > 0 && (
                <span className="grant-count">{workspace.findings.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="grant-sidebar-bottom">
          <div className="grant-avatar">{workspace.member.name.charAt(0)}</div>
          <div>
            <strong>{workspace.member.name}</strong>
            <span>{human(workspace.member.role)} access</span>
          </div>
        </div>
      </aside>
      <div className="grant-content">
        <header className="grant-topbar">
          <span>
            Team workspace <ChevronRight size={14} />{" "}
            {views.find((v) => v.id === view)?.label}
          </span>
          <div className="flex gap-2">
            <a
              className="grant-button quiet"
              href="/api/admin/grants/export"
              download
            >
              <Download size={15} />
              Export
            </a>
            <button
              className="grant-button quiet"
              disabled={busy}
              onClick={() => run(refresh)}
            >
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </header>
        <div className="grant-body">
          <div className="grant-page-title">
            <div>
              <p className="grant-eyebrow">CURATED FUNDING INTELLIGENCE</p>
              <h1>
                {view === "overview"
                  ? "Grants Matchmaker"
                  : views.find((v) => v.id === view)?.label}
              </h1>
              <p>
                {view === "overview"
                  ? "Discover opportunities. Keep the evidence current. Find the right fit."
                  : view === "opportunities"
                    ? "One program, every round, a clear source of truth."
                    : view === "queue"
                      ? "New links and source changes, ready for a human review."
                      : view === "businesses"
                        ? "Answer a few questions. Save the business profile. Find a focused shortlist."
                        : view === "sources"
                          ? "Maintain the watchlist that powers discovery and change detection."
                          : "A shared workspace with accountable ownership and a visible history."}
              </p>
            </div>
            {canEdit && (
              <button
                className="grant-button primary"
                onClick={() =>
                  view === "businesses"
                    ? setQuestionnaire({})
                    : setEditor({
                        resource: view === "sources" ? "sources" : "programs",
                        defaults: { ownerId: workspace.member.userId },
                      })
                }
              >
                <Plus size={17} />
                {view === "sources"
                  ? "Add source"
                  : view === "businesses"
                    ? "Start questionnaire"
                    : "Add program"}
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="grant-alert error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="grant-alert">
              {notice}
            </div>
          )}
          {view === "overview" && (
            <>
              {canEdit && (
                <section className="grant-matchmaker-start">
                  <div>
                    <p className="grant-eyebrow">
                      FROM BUSINESS GOAL TO FUNDING FIT
                    </p>
                    <h2>Start with a few questions.</h2>
                    <p>
                      Capture the business, project and funding needs. Get a
                      narrow list with clear reasons and next steps.
                    </p>
                  </div>
                  <button
                    className="grant-button primary"
                    onClick={() => setQuestionnaire({})}
                  >
                    Find funding matches <ChevronRight size={16} />
                  </button>
                </section>
              )}
              <div className="grant-stats">
                {[
                  {
                    label: "Programs maintained",
                    value: activePrograms.length,
                    hint: "Across public and private funders",
                    target: "opportunities",
                  },
                  {
                    label: "New & changed",
                    value: workspace.findings.length,
                    hint: "Source findings awaiting review",
                    target: "queue",
                  },
                  {
                    label: "Need verification",
                    value: needsReview.length,
                    hint: "Rounds with missing or stale evidence",
                    target: "opportunities",
                  },
                  {
                    label: "Closing in 30 days",
                    value: closing.length,
                    hint: "Current, verified application rounds",
                    target: "opportunities",
                  },
                ].map((s) => (
                  <button
                    key={s.label}
                    className="grant-stat"
                    onClick={() => {
                      setView(s.target as View);
                      setStatus(
                        s.label === "Need verification" ? "unverified" : "",
                      );
                    }}
                  >
                    <span>{s.label}</span>
                    <strong>{s.value}</strong>
                    <small>{s.hint}</small>
                  </button>
                ))}
              </div>
              <div className="grant-two-columns">
                <section className="grant-panel">
                  <PanelTitle
                    title="What needs attention"
                    subtitle="Keep the shared database useful"
                  />
                  <div className="grant-attention">
                    {[
                      {
                        value: workspace.sourceHealth.filter(
                          (s) => s.lastStatus === "error",
                        ).length,
                        label: "Sources could not be read",
                        detail: "Check the error or verify the source manually",
                        target: "sources",
                      },
                      {
                        value: activePrograms.filter((p) => !p.data.ownerId)
                          .length,
                        label: "Programs without an owner",
                        detail: "Assign someone to maintain the record",
                        target: "opportunities",
                      },
                      {
                        value: workspace.matches.filter((m) => {
                          const a = workspace.applicants.find(
                              (a) => a.id === m.data.applicantId,
                            ),
                            r = workspace.rounds.find(
                              (r) => r.id === m.data.roundId,
                            );
                          return a && r && matchNeedsReview(m.data, a, r, now);
                        }).length,
                        label: "Matches need another review",
                        detail: "Applicant facts or round evidence changed",
                        target: "businesses",
                      },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => setView(item.target as View)}
                      >
                        <b>{item.value}</b>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                </section>
                <section className="grant-panel">
                  <PanelTitle
                    title="Upcoming deadlines"
                    subtitle="Shown in each round’s recorded timezone"
                  />
                  {closing.length ? (
                    closing.slice(0, 5).map((r) => (
                      <button
                        key={r.id}
                        className="grant-list-row"
                        onClick={() => {
                          setView("opportunities");
                          setActiveProgram(r.data.programId);
                        }}
                      >
                        <span>
                          <strong>{programName(r.data.programId)}</strong>
                          <small>{r.data.name}</small>
                        </span>
                        <b>{date(r.data.closesAt, r.data.timezone)}</b>
                      </button>
                    ))
                  ) : (
                    <Empty
                      text="No verified deadlines in the next 30 days."
                      detail="Unconfirmed and stale rounds stay in the verification queue."
                    />
                  )}
                </section>
              </div>
              <section className="grant-panel mt-6">
                <PanelTitle
                  title="How the team keeps it current"
                  subtitle="Discovery feeds a review workflow"
                />
                <div className="grant-process">
                  {[
                    [
                      "01",
                      "Discover",
                      "Monitor funder pages and funding directories.",
                    ],
                    [
                      "02",
                      "Verify",
                      "Record the current round, rules and source evidence.",
                    ],
                    [
                      "03",
                      "Match",
                      "Compare business facts and surface unanswered questions.",
                    ],
                    [
                      "04",
                      "Maintain",
                      "Assign owners and review dates; preserve prior rounds.",
                    ],
                  ].map(([n, t, d]) => (
                    <div key={n}>
                      <span>{n}</span>
                      <strong>{t}</strong>
                      <p>{d}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {view === "opportunities" && (
            <>
              <div className="grant-filters">
                <label className="grant-search">
                  <Search size={17} />
                  <input
                    aria-label="Search opportunities"
                    placeholder="Search programs, funders or tags…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter timing"
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value)}
                >
                  <option value="">All timing types</option>
                  {Object.entries(cadenceLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter funding form"
                  value={funding}
                  onChange={(e) => setFunding(e.target.value)}
                >
                  <option value="">All funding forms</option>
                  {Object.entries(fundingLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter round status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All round statuses</option>
                  {[
                    "open",
                    "rolling",
                    "upcoming",
                    "unverified",
                    "closed",
                    "archived",
                  ].map((v) => (
                    <option key={v} value={v}>
                      {human(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                <span>{visiblePrograms.length} programs</span>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                  />
                  Include archived programs
                </label>
              </div>
              <div className="grant-panel overflow-auto">
                <table className="grant-table">
                  <thead>
                    <tr>
                      <th>Program / funder</th>
                      <th>Funding & timing</th>
                      <th>Latest round</th>
                      <th>Owner</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePrograms.map((p) => {
                      const r = workspace.rounds
                        .filter((r) => r.data.programId === p.id)
                        .sort((a, b) =>
                          b.createdAt.localeCompare(a.createdAt),
                        )[0];
                      return (
                        <tr key={p.id}>
                          <td>
                            <button
                              className="grant-title-link"
                              onClick={() => setActiveProgram(p.id)}
                            >
                              {p.data.name}
                            </button>
                            <small>
                              {p.data.sponsor} · {human(p.data.sponsorType)}
                            </small>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {p.data.tags.slice(0, 3).map((t) => (
                                <Badge key={t}>{t}</Badge>
                              ))}
                              {p.data.archived && <Badge>Archived</Badge>}
                            </div>
                          </td>
                          <td>
                            {fundingLabels[p.data.fundingType]}
                            <small>{cadenceLabels[p.data.cadence]}</small>
                          </td>
                          <td>
                            {r ? (
                              <>
                                <Badge state={roundState(r.data, now)}>
                                  {human(roundState(r.data, now))}
                                </Badge>
                                <small>{deadline(r.data)}</small>
                              </>
                            ) : (
                              <small>No round recorded</small>
                            )}
                          </td>
                          <td>{name(p.data.ownerId)}</td>
                          <td>
                            <button
                              aria-label={`Open ${p.data.name}`}
                              onClick={() => setActiveProgram(p.id)}
                            >
                              <ArrowUpRight size={19} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!visiblePrograms.length && (
                  <Empty
                    text="No programs match this view."
                    detail="Add a program or adjust the filters."
                  />
                )}
              </div>
              {selectedProgram && (
                <section
                  ref={detailRef}
                  tabIndex={-1}
                  className="grant-panel mt-6 scroll-mt-6"
                >
                  <div className="grant-panel-title">
                    <div>
                      <p className="grant-eyebrow">PROGRAM RECORD</p>
                      <h2>{selectedProgram.data.name}</h2>
                      <p>{selectedProgram.data.description}</p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <button
                          className="grant-button"
                          onClick={() =>
                            setEditor({
                              resource: "programs",
                              record: selectedProgram,
                            })
                          }
                        >
                          Edit program
                        </button>
                        <button
                          className="grant-button primary"
                          onClick={() => openRound(undefined, selectedProgram)}
                        >
                          <Plus size={15} />
                          Add round
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="px-5 pb-4 text-sm">
                    <a
                      href={selectedProgram.data.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="grant-source-link"
                    >
                      Official program source <ArrowUpRight size={14} />
                    </a>
                    {selectedProgram.data.notes && (
                      <p className="mt-3 whitespace-pre-wrap text-slate-600">
                        {selectedProgram.data.notes}
                      </p>
                    )}
                  </div>
                  {workspace.rounds
                    .filter((r) => r.data.programId === selectedProgram.id)
                    .map((r) => (
                      <div key={r.id} className="grant-round">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3>
                              {r.data.name}{" "}
                              <Badge state={roundState(r.data, now)}>
                                {human(roundState(r.data, now))}
                              </Badge>
                            </h3>
                            <p>
                              {r.data.amount} · {deadline(r.data)}
                            </p>
                          </div>
                          {canEdit && (
                            <button
                              className="grant-button"
                              onClick={() => openRound(r)}
                            >
                              Review / edit round
                            </button>
                          )}
                        </div>
                        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                          <div>
                            <strong>Eligibility & costs</strong>
                            <p>
                              {[
                                ...r.data.rules.roles,
                                ...r.data.rules.entities,
                                ...r.data.rules.stages,
                                ...r.data.rules.geography,
                                ...r.data.rules.costs,
                              ].join(" · ") ||
                                "Criteria have not been recorded"}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap">
                              {r.data.rules.exclusions}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap">
                              {r.data.rules.requirements}
                            </p>
                          </div>
                          <div>
                            <strong>Evidence & maintenance</strong>
                            <p className="whitespace-pre-wrap">
                              {r.data.evidence ||
                                "No verification evidence recorded"}
                            </p>
                            <a
                              className="grant-source-link mt-2"
                              href={r.data.evidenceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View evidence source <ArrowUpRight size={13} />
                            </a>
                            <small className="mt-2 block">
                              Verified {date(r.data.verifiedAt)} · Review by{" "}
                              {date(r.data.nextReviewAt)} ·{" "}
                              {name(r.data.ownerId)}
                            </small>
                          </div>
                        </div>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
          {view === "queue" && (
            <div className="space-y-4">
              {workspace.findings.length ? (
                workspace.findings.map((f) => (
                  <section key={f.id} className="grant-panel p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge state="unverified">
                        {f.kind === "discovered"
                          ? "New lead"
                          : "Source changed / first scan"}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {f.sourceName} · {date(f.createdAt)}
                      </span>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold">{f.title}</h2>
                    <a
                      className="grant-source-link mt-1 break-all"
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {new URL(f.url).hostname}
                      <ArrowUpRight size={14} />
                    </a>
                    <p className="my-3 line-clamp-4 text-sm leading-6 text-slate-600">
                      {f.excerpt}
                    </p>
                    <details className="text-xs text-slate-600">
                      <summary className="cursor-pointer">
                        Compare saved source evidence
                      </summary>
                      <div className="my-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded bg-slate-50 p-3">
                          <strong>Previous</strong>
                          <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
                            {f.previousExcerpt || "First observed snapshot"}
                          </p>
                        </div>
                        <div className="rounded bg-emerald-50 p-3">
                          <strong>Latest excerpt</strong>
                          <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
                            {f.excerpt}
                          </p>
                        </div>
                      </div>
                      <a
                        className="underline"
                        href={`/api/admin/grants/snapshot?id=${encodeURIComponent(f.snapshotId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open full text snapshot
                      </a>
                    </details>
                    {canEdit && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          className="grant-button primary"
                          onClick={() =>
                            setEditor({
                              resource: "programs",
                              defaults: {
                                name: f.title,
                                sourceUrl: f.url,
                                notes: `Discovered on ${f.sourceName}, ${date(f.createdAt)}. Verify current sponsor rules before adding an open round.`,
                                ownerId: workspace.member.userId,
                              },
                            })
                          }
                        >
                          Create program from lead
                        </button>
                        <FindingReview
                          programs={workspace.programs}
                          busy={busy}
                          onReview={(programId) =>
                            run(async () => {
                              await mutate("findings", {
                                id: f.id,
                                action: "converted",
                                programId,
                              });
                              await refresh();
                            })
                          }
                        />
                        <button
                          className="grant-button quiet"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await mutate("findings", {
                                id: f.id,
                                action: "dismissed",
                              });
                              await refresh();
                            })
                          }
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </section>
                ))
              ) : (
                <section className="grant-panel">
                  <Empty
                    text="The review queue is clear."
                    detail="Scans add new funding links and changed source pages here. Add sources to begin discovery."
                  />
                </section>
              )}
            </div>
          )}
          {view === "businesses" && (
            <>
              <div className="grant-filters">
                <select
                  aria-label="Choose business"
                  value={activeApplicant}
                  onChange={(e) => setActiveApplicant(e.target.value)}
                >
                  <option value="">Choose a business / project</option>
                  {workspace.applicants
                    .filter((a) => !a.data.archived)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.data.name}
                      </option>
                    ))}
                </select>
                {applicant && canEdit && (
                  <div className="flex gap-2">
                    <button
                      className="grant-button"
                      onClick={() => setQuestionnaire({ record: applicant })}
                    >
                      Update answers
                    </button>
                    <button
                      className="grant-button quiet"
                      onClick={() =>
                        setEditor({ resource: "applicants", record: applicant })
                      }
                    >
                      Edit record
                    </button>
                  </div>
                )}
              </div>
              {applicant ? (
                <GrantShortlist
                  applicant={applicant}
                  workspace={workspace}
                  now={now}
                  onReview={(candidate, match) =>
                    editMatch(candidate.round, match)
                  }
                />
              ) : (
                <section className="grant-panel p-6">
                  <h2 className="font-semibold">
                    Start with the business and its primary goal.
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    The questionnaire saves your answers, identifies relevant
                    funding and keeps missing facts visible for the team.
                  </p>
                  {canEdit && (
                    <button
                      className="grant-button primary mt-4"
                      onClick={() => setQuestionnaire({})}
                    >
                      Start questionnaire
                    </button>
                  )}
                </section>
              )}
            </>
          )}
          {view === "sources" && (
            <>
              <div className="grant-alert mb-5">
                <span>
                  <strong>
                    {workspace.scheduledScanning
                      ? "Daily scanning is active. "
                      : "Scheduled scanning is inactive in this environment. Use Scan due sources to run a check. "}
                  </strong>
                  Directory scans discover links; program scans flag changes.
                  Blocked pages stay visible for manual review.
                </span>
                {canEdit && (
                  <button
                    className="grant-button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await mutate("scan", {});
                        await refresh();
                        setNotice(
                          `Checked ${result.scanned} due sources. ${result.results.filter((r: { status: string }) => r.status === "error").length} need manual attention.`,
                        );
                      })
                    }
                  >
                    <RefreshCw size={15} />
                    Scan due sources
                  </button>
                )}
              </div>
              <div className="grant-panel overflow-auto">
                <table className="grant-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Purpose / cadence</th>
                      <th>Last check</th>
                      <th>Next check</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {workspace.sources.map((s) => {
                      const h = workspace.sourceHealth.find(
                        (h) => h.id === s.id,
                      );
                      return (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.data.name}</strong>
                            <small>
                              <a
                                href={s.data.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {new URL(s.data.url).hostname} ↗
                              </a>
                            </small>
                            {h?.lastError && (
                              <small className="text-red-700!">
                                {h.lastError}
                              </small>
                            )}
                          </td>
                          <td>
                            {s.data.kind === "directory"
                              ? "Discover new links"
                              : "Monitor program"}
                            <small>
                              Every {s.data.intervalDays} days ·{" "}
                              {name(s.data.ownerId)}
                            </small>
                          </td>
                          <td>
                            <Badge
                              state={
                                h?.lastStatus === "error" ? "not_eligible" : ""
                              }
                            >
                              {s.data.enabled
                                ? h?.lastStatus || "never"
                                : "Paused"}
                            </Badge>
                            <small>{date(h?.checkedAt || null)}</small>
                          </td>
                          <td>
                            {s.data.enabled
                              ? date(h?.nextScanAt || null)
                              : "Paused"}
                          </td>
                          <td>
                            {canEdit && (
                              <button
                                className="grant-button"
                                onClick={() =>
                                  setEditor({ resource: "sources", record: s })
                                }
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!workspace.sources.length && (
                  <Empty text="Add official sources to start monitoring." />
                )}
              </div>
            </>
          )}
          {view === "team" && (
            <div className="space-y-6">
              <section className="grant-panel">
                <PanelTitle
                  title="Team access"
                  subtitle="Everyone works in the same database. Viewers can read; editors can maintain records."
                />
                <div className="px-5 pb-5">
                  {workspace.members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex flex-wrap items-center justify-between gap-3 border-b py-4"
                    >
                      <div>
                        <strong className="text-sm">{m.name}</strong>
                        <p className="text-xs text-slate-500">{m.email}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge>{m.role}</Badge>
                        {workspace.member.role === "owner" &&
                          m.role !== "owner" && (
                            <>
                              <button
                                className="grant-button quiet"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await mutate("members", {
                                      userId: m.userId,
                                      role:
                                        m.role === "editor"
                                          ? "viewer"
                                          : "editor",
                                      active: true,
                                    });
                                    await refresh();
                                  })
                                }
                              >
                                Make {m.role === "editor" ? "viewer" : "editor"}
                              </button>
                              <button
                                className="grant-button quiet"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await mutate("members", {
                                      userId: m.userId,
                                      role: m.role,
                                      active: false,
                                    });
                                    await refresh();
                                  })
                                }
                              >
                                Remove access
                              </button>
                            </>
                          )}
                      </div>
                    </div>
                  ))}
                  {workspace.member.role === "owner" && (
                    <TeamAccess onAdded={() => run(refresh)} />
                  )}
                </div>
              </section>
              <section className="grant-panel">
                <PanelTitle
                  title="Recent activity"
                  subtitle="Changes are attributed and prior record versions are preserved in the database."
                />
                {workspace.activity.slice(0, 40).map((a) => (
                  <div key={a.id} className="grant-list-row">
                    <span>
                      <strong>
                        {human(a.action.toLowerCase())} · {a.resource}
                      </strong>
                      <small>{name(a.actor)}</small>
                    </span>
                    <time className="text-xs text-slate-500">{date(a.at)}</time>
                  </div>
                ))}
                {!workspace.activity.length && (
                  <Empty text="Changes will appear here." />
                )}
              </section>
            </div>
          )}
          <footer className="grant-footer">
            <ShieldCheck size={14} />
            Private to your team · Source evidence supports discovery; funders
            determine eligibility.
          </footer>
        </div>
      </div>
      {questionnaire && (
        <FundingQuestionnaire
          record={questionnaire.record}
          ownerId={workspace.member.userId}
          onClose={() => setQuestionnaire(null)}
          onSave={async (data) => {
            const saved = await mutate("applicants", {
              id: questionnaire.record?.id,
              version: questionnaire.record?.version,
              data,
            });
            setWorkspace((current) => ({
              ...current,
              applicants: [
                saved.record,
                ...current.applicants.filter((a) => a.id !== saved.record.id),
              ],
            }));
            setActiveApplicant(saved.record.id);
            setView("businesses");
            setQuestionnaire(null);
            setNotice(
              "Business profile saved. Your shortlist uses these answers and the recorded program criteria.",
            );
            try {
              await refresh();
            } catch {
              setError(
                "Profile saved successfully. The full workspace could not refresh; use Refresh to get the latest program records.",
              );
            }
          }}
        />
      )}
      {editor && (
        <RecordEditor
          key={`${editor.resource}-${editor.record?.id || "new"}`}
          target={editor}
          workspace={workspace}
          onClose={() => setEditor(null)}
          onSave={async (data) => {
            await mutate(editor.resource, {
              id: editor.record?.id,
              version: editor.record?.version,
              data,
            });
            await refresh();
            setEditor(null);
            setNotice("Saved to the shared workspace.");
          }}
        />
      )}
    </div>
  );
}
function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="grant-panel-title">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function Empty({ text, detail }: { text: string; detail?: string }) {
  return (
    <div className="grant-empty">
      <Inbox size={25} />
      <strong>{text}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
function Badge({
  children,
  state = "",
}: {
  children: React.ReactNode;
  state?: string;
}) {
  return (
    <span
      className={`grant-badge ${["open", "rolling", "approved"].includes(state) ? "green" : ["unverified", "needs_information"].includes(state) ? "amber" : state === "not_eligible" ? "red" : ""}`}
    >
      {children}
    </span>
  );
}
function FindingReview({
  programs,
  busy,
  onReview,
}: {
  programs: GrantRecord<Program>[];
  busy: boolean;
  onReview: (id: string) => void;
}) {
  const [id, setId] = useState("");
  return (
    <div className="flex gap-2">
      <select
        aria-label="Link finding to program"
        className="max-w-48 rounded-lg border px-2 text-xs"
        value={id}
        onChange={(e) => setId(e.target.value)}
      >
        <option value="">Link to a program…</option>
        {programs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.data.name}
          </option>
        ))}
      </select>
      <button
        className="grant-button"
        disabled={!id || busy}
        onClick={() => onReview(id)}
      >
        Mark reviewed
      </button>
    </div>
  );
}
function TeamAccess({ onAdded }: { onAdded: () => Promise<void> }) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("editor"),
    [account, setAccount] = useState<{
      id: string;
      name: string;
      email: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (account) {
            await mutate("members", { userId: account.id, role, active: true });
            setAccount(null);
            setEmail("");
            await onAdded();
          } else {
            const res = await fetch(
              `/api/admin/grants/accounts?email=${encodeURIComponent(email)}`,
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            if (data.accounts.length !== 1)
              throw new Error(
                "No unique existing Explorer account found. Ask this teammate to create their account first.",
              );
            setAccount(data.accounts[0]);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not update access");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="text-sm font-semibold">
        Add an existing Explorer account
      </h3>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-60 flex-1 rounded-lg border px-3 py-2 text-sm"
          type="email"
          aria-label="Teammate account email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setAccount(null);
          }}
          placeholder="teammate@example.org"
        />
        <select
          className="rounded-lg border px-3 text-sm"
          aria-label="Teammate role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button className="grant-button primary" disabled={busy}>
          {busy ? "Working…" : account ? "Grant access" : "Find account"}
        </button>
      </div>
      {account && (
        <p className="text-sm">
          Confirm account: <strong>{account.name}</strong> ({account.email}).
          Granting access does not send an email.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
