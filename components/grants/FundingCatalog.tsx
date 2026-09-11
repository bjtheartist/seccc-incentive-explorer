"use client";
import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { ArrowUpRight, Search, X } from "lucide-react";
import {
  catalogSources,
  safeCatalogUrl,
  type CatalogItem,
  type CatalogPage,
  type CatalogSuggestions,
} from "@/lib/grants/catalog-model";
import type { Applicant, GrantRecord } from "@/lib/grants/model";
const human = (s: string) =>
  s.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
const timing = {
  current: "Reported current window",
  upcoming: "Upcoming window",
  closed: "Past deadline",
  unconfirmed: "Application window unconfirmed",
};
type ReviewHandler = (programId: string, roundId: string) => Promise<void>;
async function read(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { cache: "no-store", signal });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "Could not load the funding database");
  return data;
}

export function FundingCatalog({
  canEdit,
  onReview,
}: {
  canEdit: boolean;
  onReview: ReviewHandler;
}) {
  const [q, setQ] = useState(""),
    [filters, setFilters] = useState({
      q: "",
      source: "",
      type: "",
      timing: "",
      scope: "chicago",
      page: "1",
    });
  const [result, setResult] = useState<CatalogPage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    read(
      `/api/admin/grants/catalog?${new URLSearchParams(filters)}`,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, retry]);
  const updateFilters = (next: typeof filters) => {
    setLoading(true);
    setError("");
    setFilters(next);
  };
  const change = (key: string, value: string) =>
    updateFilters({ ...filters, [key]: value, page: "1" });
  return (
    <>
      {result && (
        <div className="grant-stats">
          {[
            ["Source records", result.counts.total],
            ["Curated source records", result.counts.curated],
            ["Foundation profiles", result.counts.foundations],
            ["Standing programs", result.counts.standing],
          ].map(([label, value]) => (
            <div className="grant-panel p-5" key={label}>
              <p className="text-xs text-slate-500">{label}</p>
              <strong className="mt-2 block text-2xl">
                {Number(value).toLocaleString()}
              </strong>
            </div>
          ))}
        </div>
      )}
      <div className="grant-alert mb-5">
        This database combines dated opportunities, standing programs and
        foundation filings. Complete source fields do not establish current
        availability or eligibility. Start a staff review to add a source to the
        maintained opportunity catalog.
      </div>
      <form
        className="grant-filters"
        onSubmit={(e) => {
          e.preventDefault();
          change("q", q);
        }}
      >
        <label className="flex min-w-48 flex-1 items-center gap-2">
          <Search size={16} />
          <input
            aria-label="Search funding database"
            placeholder="Search names, funders or purpose…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={200}
          />
        </label>
        <button className="grant-button" type="submit">
          Search database
        </button>
        <select
          aria-label="Funding database source"
          value={filters.source}
          onChange={(e) => change("source", e.target.value)}
        >
          <option value="">All sources</option>
          {catalogSources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Funding record type"
          value={filters.type}
          onChange={(e) => change("type", e.target.value)}
        >
          <option value="">All record types</option>
          <option value="opportunity">Dated opportunities</option>
          <option value="foundation">Foundation profiles</option>
          <option value="standing_program">Standing programs</option>
        </select>
        <select
          aria-label="Funding application timing"
          value={filters.timing}
          onChange={(e) => change("timing", e.target.value)}
        >
          <option value="">Any timing</option>
          {Object.entries(timing).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Funding database geography"
          value={filters.scope}
          onChange={(e) => change("scope", e.target.value)}
        >
          <option value="chicago">Potential Chicago relevance</option>
          <option value="all">All geographies</option>
        </select>
      </form>
      {error && (
        <div className="grant-alert error" role="alert">
          {error}
          <button
            className="grant-button"
            onClick={() => {
              setLoading(true);
              setError("");
              setRetry((r) => r + 1);
            }}
          >
            Retry database
          </button>
        </div>
      )}
      {loading ? (
        <p role="status" className="p-6 text-sm text-slate-500">
          Loading funding database…
        </p>
      ) : (
        !error &&
        result && (
          <>
            <p className="mb-3 text-sm text-slate-500">
              {result.total.toLocaleString()} matching source records · Page{" "}
              {result.page} of{" "}
              {Math.max(1, Math.ceil(result.total / result.pageSize))}
            </p>
            <div className="grant-panel overflow-auto">
              <table className="grant-table">
                <thead>
                  <tr>
                    <th>Program / funder</th>
                    <th>Source & record type</th>
                    <th>Window / amount</th>
                    <th>Research status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((r) => (
                    <tr key={r.id} data-testid="catalog-row">
                      <td>
                        <button
                          className="text-left font-semibold hover:underline"
                          onClick={() => setSelected(r.id)}
                        >
                          {r.name}
                        </button>
                        <small>{r.sponsor}</small>
                      </td>
                      <td>
                        {r.source}
                        <small>{human(r.recordType)}</small>
                      </td>
                      <td>
                        {timing[r.timing]}
                        <small>
                          {r.deadline
                            ? `Source deadline: ${r.deadline} · time to verify`
                            : "No confirmed deadline"}
                        </small>
                        <small>{r.amount}</small>
                      </td>
                      <td>
                        <span className="grant-badge">
                          {r.linkedRoundId
                            ? "In staff review catalog"
                            : r.complete
                              ? "Source fields complete"
                              : "Needs research"}
                        </span>
                        <small>Source checked {r.checkedAt || "unknown"}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!result.items.length && (
                <p className="p-6 text-sm text-slate-500">
                  No source records match these filters.
                </p>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button
                className="grant-button"
                disabled={result.page <= 1}
                onClick={() =>
                  updateFilters({ ...filters, page: String(result.page - 1) })
                }
              >
                Previous page
              </button>
              <button
                className="grant-button"
                disabled={result.page * result.pageSize >= result.total}
                onClick={() =>
                  updateFilters({ ...filters, page: String(result.page + 1) })
                }
              >
                Next page
              </button>
            </div>
          </>
        )
      )}
      {selected && (
        <CatalogDetail
          key={selected}
          id={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onReview={onReview}
        />
      )}
    </>
  );
}

export function CatalogSuggestionsPanel({
  applicant,
  limit,
  canEdit,
  onReview,
}: {
  applicant: GrantRecord<Applicant>;
  limit: number;
  canEdit: boolean;
  onReview: ReviewHandler;
}) {
  const [result, setResult] = useState<CatalogSuggestions | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    read(
      `/api/admin/grants/catalog?applicantId=${encodeURIComponent(applicant.id)}`,
      c.signal,
    )
      .then((data) => {
        if (!c.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [applicant.id, applicant.version, retry]);
  if (limit <= 0) return null;
  return (
    <section className="mt-7">
      <h2 className="mb-2 font-semibold">
        Additional leads from the funding database
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        Up to {limit} leads based on this business&apos;s answers. Review the
        full source before adding an opportunity to the maintained catalog.
      </p>
      {error ? (
        <div className="grant-alert error" role="alert">
          {error}
          <button
            className="grant-button"
            onClick={() => {
              setResult(null);
              setError("");
              setRetry((r) => r + 1);
            }}
          >
            Retry leads
          </button>
        </div>
      ) : !result ? (
        <p role="status" className="text-sm text-slate-500">
          Searching source records…
        </p>
      ) : (
        <>
          <p className="mb-4 text-xs text-slate-500">{result.explanation}</p>
          <div className="space-y-3">
            {result.items.slice(0, limit).map((r) => (
              <article
                className="grant-panel p-5"
                key={r.id}
                data-testid="catalog-suggestion"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{r.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {r.sponsor} · {r.source} · {human(r.recordType)}
                    </p>
                  </div>
                  <button
                    className="grant-button"
                    onClick={() => setSelected(r.id)}
                  >
                    Review source
                  </button>
                </div>
                <p className="mt-3 text-sm">
                  {r.amount} · {human(r.fundingType)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {timing[r.timing]} ·{" "}
                  {r.deadline
                    ? `Source deadline ${r.deadline}; time to verify`
                    : "No confirmed deadline"}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {r.purpose ||
                    `Recorded expense categories: ${r.uses.map(human).join(", ")}`}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  Confirm applicant eligibility, eligible expenses and exact
                  location.{" "}
                  {r.missing.length
                    ? `Missing fields: ${r.missing.join(", ")}.`
                    : ""}
                </p>
              </article>
            ))}
          </div>
          {!result.items.length && (
            <p className="grant-panel p-5 text-sm text-slate-500">
              No additional source leads match the recorded answers. Search the
              funding database or refine the project details.
            </p>
          )}
        </>
      )}
      {selected && (
        <CatalogDetail
          key={selected}
          id={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onReview={onReview}
        />
      )}
    </section>
  );
}

function CatalogDetail({
  id,
  canEdit,
  onClose,
  onReview,
}: {
  id: string;
  canEdit: boolean;
  onClose: () => void;
  onReview: ReviewHandler;
}) {
  const [record, setRecord] = useState<CatalogItem | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    read(`/api/admin/grants/catalog?id=${encodeURIComponent(id)}`, c.signal)
      .then(setRecord)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id]);
  const review = async () => {
    setBusy(true);
    setError("");
    try {
      let programId = record?.linkedProgramId,
        roundId = record?.linkedRoundId;
      if (!programId || !roundId) {
        const res = await fetch("/api/admin/grants/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        programId = body.programId;
        roundId = body.roundId;
      }
      await onReview(programId!, roundId!);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start review");
    } finally {
      setBusy(false);
    }
  };
  const format = (v: unknown): string =>
    Array.isArray(v)
      ? v.map(format).join("; ")
      : v && typeof v === "object"
        ? Object.entries(v)
            .filter(([, x]) => x !== null && x !== "")
            .map(([k, x]) => `${human(k)}: ${format(x)}`)
            .join(" · ")
        : v === null || v === ""
          ? "Not recorded"
          : String(v);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-[#0C1B33]/55 backdrop-blur-sm" />
        <Dialog.Content className="grant-dialog fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(850px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold">
                {record?.name || "Funding source record"}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-slate-500">
                Original source information. Import completeness is separate
                from staff verification.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close funding source" disabled={busy}>
              <X size={20} />
            </Dialog.Close>
          </div>
          {error && (
            <p role="alert" className="grant-alert error mt-4">
              {error}
            </p>
          )}
          {!record && !error && <p className="p-5">Loading source…</p>}
          {record && (
            <>
              <div className="my-5 flex flex-wrap gap-3">
                {record.sourceUrl && (
                  <a
                    className="grant-button"
                    href={record.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open source <ArrowUpRight size={14} />
                  </a>
                )}
                {canEdit && (
                  <button
                    className="grant-button primary"
                    disabled={busy}
                    onClick={() => void review()}
                  >
                    {busy
                      ? "Starting review…"
                      : record.linkedRoundId
                        ? "Open staff review"
                        : "Start staff review"}
                  </button>
                )}
              </div>
              <p className="grant-alert mb-5">
                Starting a review preserves this source and creates an
                unverified application round. Staff must confirm the window,
                exact deadline time, geographic rules and eligible expenses.
              </p>
              {[
                "program",
                "window",
                "funding",
                "applicants",
                "uses",
                "requirements",
                "verification",
              ].map((group) => (
                <section key={group} className="mb-5">
                  <h3 className="mb-2 font-semibold capitalize">
                    {human(group)}
                  </h3>
                  <dl className="grant-intake-summary">
                    {Object.entries(
                      (record.payload?.[group] || {}) as Record<
                        string,
                        unknown
                      >,
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dt>{human(k)}</dt>
                        <dd>
                          {safeCatalogUrl(v) ? (
                            <a
                              className="underline"
                              href={safeCatalogUrl(v)!}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {String(v)}
                            </a>
                          ) : (
                            format(v)
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
              {Boolean(record.payload?.notes) && (
                <p className="text-sm text-slate-600">
                  {String(record.payload?.notes)}
                </p>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
