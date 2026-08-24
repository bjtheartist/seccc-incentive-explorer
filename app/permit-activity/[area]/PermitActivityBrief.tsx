"use client";

import Link from "next/link";
import {
  Check,
  ExternalLink,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  PERMIT_AREA_ACTIVITY_NOTE,
  PERMIT_AREA_COVERAGE_NOTE,
  PERMIT_AREA_REQUEST_TIMEOUT_MS,
  formatPermitAreaDate,
  parsePermitAreaResult,
  type PermitAreaGeometry,
  type PermitAreaRecord,
  type PermitAreaResult,
} from "@/lib/permit-area";
import styles from "./permit-activity.module.css";

type BriefState =
  | { kind: "loading" }
  | { kind: "ready"; data: PermitAreaResult }
  | { kind: "zero"; data: PermitAreaResult }
  | { kind: "unavailable" }
  | { kind: "malformed" };

interface PermitActivityBriefProps {
  area: { id: number; name: string; slug: string };
  geometry: PermitAreaGeometry;
  reportDate: string;
}

interface CountRow {
  label: string;
  count: number;
}

const formatCount = (value: number) => value.toLocaleString("en-US");

function formatShare(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "0.0%";
}

function compactRows(
  rows: CountRow[],
  maxRows: number,
  otherLabel: (hiddenRows: number) => string,
): CountRow[] {
  if (rows.length <= maxRows) return rows;
  const visible = rows.slice(0, maxRows - 1);
  const hidden = rows.slice(maxRows - 1);
  return [
    ...visible,
    {
      label: otherLabel(hidden.length),
      count: hidden.reduce((sum, row) => sum + row.count, 0),
    },
  ];
}

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildPermitBriefCsv(
  areaName: string,
  result: PermitAreaResult,
): string {
  const rows: Array<Array<string | number | null>> = [
    ["Chicago Incentive Explorer", "Permit Activity Analysis"],
    ["Community area", areaName],
    ["Source", result.source.label],
    ["Source URL", result.source.url],
    ["Coverage", result.dataWindow],
    ["Geocoded records only", result.locatedRecordsOnly ? "Yes" : "No"],
    ["Recorded filings", result.totalFilings],
    ["Distinct addresses", result.distinctAddresses],
    ["First filing", result.issueDateSpan?.first ?? null],
    ["Latest filing", result.issueDateSpan?.latest ?? null],
    ["Source refreshed", result.sourceRefresh.asOf],
    ["Returned recent records", result.recordsReturned],
    ["Recent records truncated", result.recordsTruncated ? "Yes" : "No"],
    [],
    ["Annual filing counts"],
    ["Year", "Filings"],
    ...result.yearBreakdown.map((row) => [row.year, row.count]),
    [],
    ["Source-recorded filing types"],
    ["Filing type", "Source value", "Filings"],
    ...result.typeBreakdown.map((row) => [row.label, row.sourceValue, row.count]),
    [],
    ["Source-recorded statuses"],
    ["Status", "Records"],
    ...result.statusBreakdown.map((row) => [row.status, row.count]),
    [],
    ["Recent permit records"],
    [
      "Permit ID",
      "Issue date",
      "Permit type",
      "Raw permit type",
      "Source status",
      "Street address",
      "Source milestone",
      "Work type",
      "Work description",
    ],
    ...result.records.map((record) => [
      record.permitId,
      record.issueDate,
      record.permitTypeLabel,
      record.rawPermitType,
      record.permitStatus,
      record.address,
      record.permitMilestone,
      record.workType,
      record.workDescription,
    ]),
    [],
    ["Coverage note", PERMIT_AREA_COVERAGE_NOTE],
    ["Interpretation note", PERMIT_AREA_ACTIVITY_NOTE],
    [
      "Denominator note",
      `Aggregate tables cover ${formatCount(result.totalFilings)} matching records; the recent-record ledger contains ${formatCount(result.recordsReturned)} returned rows.`,
    ],
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function usePermitArea(geometry: PermitAreaGeometry) {
  const [state, setState] = useState<BriefState>({ kind: "loading" });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ kind: "loading" });

    const timeout = window.setTimeout(
      () => controller.abort("permit-area-timeout"),
      PERMIT_AREA_REQUEST_TIMEOUT_MS,
    );

    void (async () => {
      try {
        const response = await fetch("/api/permit-area", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ polygon: geometry }),
          signal: controller.signal,
        });
        if (!active) return;
        if (!response.ok) {
          setState({ kind: "unavailable" });
          return;
        }

        const body: unknown = await response.json();
        if (!active) return;
        const parsed = parsePermitAreaResult(body);
        if (!parsed) {
          setState({ kind: "malformed" });
          return;
        }
        setState(
          parsed.totalFilings === 0
            ? { kind: "zero", data: parsed }
            : { kind: "ready", data: parsed },
        );
      } catch {
        if (active) setState({ kind: "unavailable" });
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort("permit-area-route-changed");
    };
  }, [geometry, requestVersion]);

  return {
    state,
    retry: () => setRequestVersion((version) => version + 1),
  };
}

function stateMetric(
  state: BriefState,
  value: (result: PermitAreaResult) => string,
): string {
  if (state.kind === "loading") return "Loading…";
  if (state.kind === "unavailable" || state.kind === "malformed") return "Unavailable";
  return value(state.data);
}

function openDialog(ref: React.RefObject<HTMLDialogElement | null>) {
  const dialog = ref.current;
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(ref: React.RefObject<HTMLDialogElement | null>) {
  const dialog = ref.current;
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function CountTable({
  title,
  caption,
  total,
  rows,
  statusId,
  initialStatus,
}: {
  title: string;
  caption: string;
  total: number;
  rows: CountRow[];
  statusId: string;
  initialStatus: string;
}) {
  const [markStatus, setMarkStatus] = useState(initialStatus);
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <>
      <table className={styles.barTable}>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>{title}</th>
            <th aria-label="Visual share" />
            <th className={styles.num}>Records</th>
            <th className={styles.num}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const share = formatShare(row.count, total);
            const label = `${row.label} · ${formatCount(row.count)} · ${share}`;
            return (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className={styles.barCell}>
                  <button
                    className={styles.horizontalMark}
                    type="button"
                    style={{ "--width": `${(row.count / max) * 100}%` } as CSSProperties}
                    aria-label={`${row.label}, ${formatCount(row.count)} records, ${share}`}
                    onFocus={() => setMarkStatus(label)}
                    onClick={() => setMarkStatus(label)}
                  >
                    <span />
                  </button>
                </td>
                <td className={styles.num}>{formatCount(row.count)}</td>
                <td className={styles.num}>{share}</td>
              </tr>
            );
          })}
          <tr>
            <td><strong>Total</strong></td>
            <td />
            <td className={styles.num}><strong>{formatCount(total)}</strong></td>
            <td className={styles.num}><strong>100%</strong></td>
          </tr>
        </tbody>
      </table>
      <p id={statusId} className={styles.markStatus} aria-live="polite">
        {markStatus}
      </p>
    </>
  );
}

function PermitRecordDialog({
  dialogRef,
  record,
  sourceUrl,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  record: PermitAreaRecord | null;
  sourceUrl: string;
}) {
  const detail: Array<[string, string | null | undefined]> = [
    ["Permit ID", record?.permitId],
    ["Raw permit type", record?.rawPermitType],
    ["Address", record?.address],
    ["Issue date", record?.issueDate ? formatPermitAreaDate(record.issueDate) : null],
    ["Source status", record?.permitStatus],
    ["Source milestone", record?.permitMilestone],
    ["Work type", record?.workType],
    ["Work description", record?.workDescription],
  ];

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="permit-record-title">
      <div className={styles.dialogHead}>
        <div>
          <span className={styles.dialogKicker}>Source record</span>
          <h2 id="permit-record-title">Permit filing detail</h2>
        </div>
        <button
          className={styles.dialogClose}
          type="button"
          onClick={() => closeDialog(dialogRef)}
          aria-label="Close permit record dialog"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className={styles.dialogBody}>
        <dl className={styles.recordDetail}>
          {detail.map(([label, value]) => (
            <div className={styles.detailRow} key={label}>
              <dt>{label}</dt>
              <dd>{value || "Unavailable in this source record"}</dd>
            </div>
          ))}
        </dl>
        <p>
          Only fields represented by the current permit-area contract appear here. No
          cost field or inferred project progress is displayed.
        </p>
        <a className={styles.officialLink} href={sourceUrl} target="_blank" rel="noreferrer">
          Open the official Chicago Building Permits dataset
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
    </dialog>
  );
}

export function PermitActivityBrief({
  area,
  geometry,
  reportDate,
}: PermitActivityBriefProps) {
  const { state, retry } = usePermitArea(geometry);
  const result = state.kind === "ready" || state.kind === "zero" ? state.data : null;
  const dataWindowLabel =
    state.kind === "loading"
      ? "Loading"
      : state.kind === "unavailable" || state.kind === "malformed"
        ? "Unavailable"
        : state.data.dataWindow;
  const [selectedRecord, setSelectedRecord] = useState<PermitAreaRecord | null>(null);
  const [trendStatus, setTrendStatus] = useState(
    "Focus or select a bar for its exact source-recorded count.",
  );
  const [toast, setToast] = useState("");
  const recordDialogRef = useRef<HTMLDialogElement>(null);
  const sourceDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const typeRows = useMemo(() => {
    if (!result) return [];
    return compactRows(
      result.typeBreakdown.map((row) => ({ label: row.label, count: row.count })),
      8,
      (hidden) => `Other (${hidden} source types)`,
    );
  }, [result]);

  const statusRows = useMemo(() => {
    if (!result) return [];
    return compactRows(
      result.statusBreakdown.map((row) => ({ label: row.status, count: row.count })),
      7,
      (hidden) => `Other (${hidden} source statuses)`,
    );
  }, [result]);

  const years = useMemo(
    () => result?.yearBreakdown.slice().sort((a, b) => a.year - b.year) ?? [],
    [result],
  );
  const maxYearCount = Math.max(1, ...years.map((row) => row.count));
  const recordsShown = result?.records.slice(0, 4) ?? [];

  const suggests = useMemo(() => {
    if (state.kind === "loading") return "Loading the source-backed filing summary.";
    if (state.kind === "unavailable" || state.kind === "malformed") {
      return "No filing pattern is described because the source did not return a usable response.";
    }
    if (state.kind === "zero") {
      return "The source returned a valid zero for geocoded permit filings inside this community-area boundary and source window.";
    }
    const peak = state.data.yearBreakdown.reduce((best, row) =>
      row.count > best.count ? row : best,
    );
    const topType = state.data.typeBreakdown[0];
    const topStatus = state.data.statusBreakdown[0];
    return `${formatCount(state.data.totalFilings)} geocoded filings appear in the source window. The highest recorded annual count is ${formatCount(peak.count)} in ${peak.year}. ${topType?.label ?? "No filing type"} is the leading source-recorded type, and ${topStatus?.status ?? "no status"} is the most common recorded status.`;
  }, [state]);

  const downloadBrief = () => {
    if (!result) return;
    const blob = new Blob([buildPermitBriefCsv(area.name, result)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `permit-activity-${area.slug}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    setToast("Source-backed permit brief downloaded.");
  };

  const showRecord = (record: PermitAreaRecord) => {
    setSelectedRecord(record);
    window.setTimeout(() => openDialog(recordDialogRef), 0);
  };

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#permit-analysis">Skip to analysis</a>
      <div id="permit-analysis" className={styles.briefShell}>
        <nav className={styles.topbar} aria-label="Evidence brief navigation">
          <Link className={styles.brand} href="/investment">
            Chicago Incentive Explorer / Evidence Briefs
          </Link>
          <div className={styles.tabs} role="list" aria-label="Analysis briefs">
            <Link
              className={styles.tab}
              href={`/investment/${encodeURIComponent(area.name)}`}
            >
              Public Investment Analysis
            </Link>
            <Link
              className={styles.tab}
              href={`/permit-activity/${area.slug}`}
              aria-current="page"
            >
              Permit Activity Analysis
            </Link>
          </div>
        </nav>

        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Live public data · Official community-area boundary</p>
            <h1>Permit Activity Analysis · {area.name}</h1>
            <p className={styles.metaLine}>
              <span>Area {area.id} · {area.name}</span>
              <span>Data window {dataWindowLabel}</span>
              <span>Report date {reportDate}</span>
            </p>
          </div>
          <aside className={styles.headerAside} aria-label="Trust statement">
            <h2 className={styles.panelTitle}>Trust statement</h2>
            <p>{PERMIT_AREA_ACTIVITY_NOTE}</p>
          </aside>
        </header>

        <section className={styles.evidenceStrip} aria-label="Permit evidence summary">
          <article className={styles.evidenceStat}>
            <h2 className={styles.metricLabel}>Recorded filings</h2>
            <p className={styles.metricValue}>
              {stateMetric(state, (data) => formatCount(data.totalFilings))}
            </p>
            <span className={styles.sourceLabel}>Geocoded source records</span>
          </article>
          <article className={styles.evidenceStat}>
            <h2 className={styles.metricLabel}>Distinct addresses</h2>
            <p className={styles.metricValue}>
              {stateMetric(state, (data) => formatCount(data.distinctAddresses))}
            </p>
            <span className={styles.sourceLabel}>Normalized source addresses</span>
          </article>
          <article className={styles.evidenceStat}>
            <h2 className={styles.metricLabel}>Latest filing</h2>
            <p className={styles.metricValue}>
              {stateMetric(state, (data) => formatPermitAreaDate(data.issueDateSpan?.latest ?? null))}
            </p>
            <span className={styles.sourceLabel}>Issue date</span>
          </article>
          <article className={styles.evidenceStat}>
            <h2 className={styles.metricLabel}>Source refreshed</h2>
            <p className={styles.metricValue}>
              {stateMetric(state, (data) => formatPermitAreaDate(data.sourceRefresh.asOf))}
            </p>
            <span className={styles.sourceLabel}>Latest queried row timestamp</span>
          </article>
        </section>

        {state.kind === "loading" ? (
          <div className={styles.stateBanner} role="status">
            <strong>Loading permit-area analysis.</strong> The page is querying the existing
            permit-area endpoint with the official {area.name} boundary.
          </div>
        ) : null}

        {state.kind === "zero" ? (
          <div className={styles.stateBanner} role="status">
            <strong>0 recorded filings in this geocoded source window.</strong> This is a valid
            zero, not evidence that no work occurred.
          </div>
        ) : null}

        {state.kind === "unavailable" || state.kind === "malformed" ? (
          <div className={styles.stateBanner} role="alert">
            <div>
              <strong>
                {state.kind === "malformed"
                  ? "Source response malformed."
                  : "Source lookup unavailable."}
              </strong>{" "}
              The page withholds charts instead of substituting zero. Retry or verify against
              the official publisher.
            </div>
            <button className={styles.retryButton} type="button" onClick={retry}>
              <RefreshCw aria-hidden="true" /> Retry lookup
            </button>
          </div>
        ) : null}

        {state.kind === "ready" && result ? (
          <>
            <div className={styles.evidenceGrid}>
              <section className={styles.panel} aria-labelledby="permit-trend-title">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="permit-trend-title" className={styles.panelTitle}>Filing activity over time</h2>
                    <p className={styles.panelSubtitle}>Annual filings by issue year · no project-value estimate</p>
                  </div>
                  <span className={styles.sourceChip}>Live source</span>
                </div>
                <div className={styles.permitBars} aria-label="Annual permit filing chart">
                  {years.map((row) => {
                    const label = `${row.year} · ${formatCount(row.count)} recorded filings`;
                    return (
                      <button
                        className={styles.permitYear}
                        type="button"
                        key={row.year}
                        aria-label={`${row.year}, ${formatCount(row.count)} recorded filings`}
                        onFocus={() => setTrendStatus(label)}
                        onClick={() => setTrendStatus(label)}
                      >
                        <span
                          className={styles.permitYearBar}
                          style={{ "--height": `${(row.count / maxYearCount) * 100}%` } as CSSProperties}
                        >
                          <span>{formatCount(row.count)}</span>
                        </span>
                        <span className={styles.yearLabel}>{row.year}</span>
                      </button>
                    );
                  })}
                </div>
                <p className={styles.markStatus} aria-live="polite">{trendStatus}</p>
                <p className={styles.chartNote}>
                  Counts reconcile to {formatCount(result.totalFilings)} recorded filings.
                  {result.issueDateSpan
                    ? ` The latest source filing is dated ${formatPermitAreaDate(result.issueDateSpan.latest)}.`
                    : ""}
                </p>
              </section>

              <section className={styles.panel} aria-labelledby="permit-type-title">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="permit-type-title" className={styles.panelTitle}>What was filed?</h2>
                    <p className={styles.panelSubtitle}>Source-recorded filing types · count and share</p>
                  </div>
                  <span className={styles.sourceChip}>Live source</span>
                </div>
                <CountTable
                  title="Filing type"
                  caption={`Displayed rows reconcile to ${formatCount(result.totalFilings)} source records; smaller categories may be grouped.`}
                  total={result.totalFilings}
                  rows={typeRows}
                  statusId="permit-type-status"
                  initialStatus="Focus or select a bar for its exact source-recorded count and share."
                />
              </section>

              <section className={styles.panel} aria-labelledby="permit-status-title">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="permit-status-title" className={styles.panelTitle}>Recorded status</h2>
                    <p className={styles.panelSubtitle}>Status exactly as recorded by the source</p>
                  </div>
                  <span className={styles.sourceChip}>Live source</span>
                </div>
                <CountTable
                  title="Status"
                  caption={`Displayed rows reconcile to ${formatCount(result.totalFilings)} source records; smaller categories may be grouped.`}
                  total={result.totalFilings}
                  rows={statusRows}
                  statusId="permit-status-status"
                  initialStatus="Focus or select a bar for its exact source-recorded count and share."
                />
                <p className={styles.chartNote}>
                  Status labels are reproduced from source records; they do not establish
                  occupancy, completion, or compliance.
                </p>
              </section>
            </div>

            <div className={styles.ledgerGrid}>
              <section className={styles.panel} aria-labelledby="ledger-title">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="ledger-title" className={styles.panelTitle}>Recent permit records</h2>
                    <p className={styles.panelSubtitle}>
                      {formatCount(recordsShown.length)} of {formatCount(result.recordsReturned)} returned rows shown · summary covers all {formatCount(result.totalFilings)} matching records
                    </p>
                  </div>
                  <span className={styles.sourceChip}>Live source</span>
                </div>
                <table className={styles.recordTable}>
                  <caption>
                    Recent-record ledger. Select a row action to review fields allowed by the
                    current permit-area contract.
                  </caption>
                  <thead>
                    <tr>
                      <th>Filing date</th>
                      <th>Permit type</th>
                      <th>Status</th>
                      <th>Street address</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordsShown.map((record) => (
                      <tr key={record.permitId}>
                        <td data-label="Filing date">{formatPermitAreaDate(record.issueDate)}</td>
                        <td data-label="Permit type">{record.permitTypeLabel}</td>
                        <td data-label="Source status">{record.permitStatus ?? "Not recorded"}</td>
                        <td data-label="Street address">{record.address ?? "Not recorded"}</td>
                        <td data-label="Action">
                          <button type="button" onClick={() => showRecord(record)}>View record</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <aside className={styles.panel} aria-labelledby="quality-title">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="quality-title" className={styles.panelTitle}>Data coverage &amp; quality</h2>
                    <p className={styles.panelSubtitle}>Location, truncation, and value-state context</p>
                  </div>
                  <span className={styles.sourceChip}>Live source</span>
                </div>
                <ul className={styles.qualityList}>
                  <li><Check className={styles.statusDot} aria-hidden="true" /><span>Geocoded records only (<code>locatedRecordsOnly</code>).</span></li>
                  <li><Check className={styles.statusDot} aria-hidden="true" /><span>Aggregate charts cover {formatCount(result.totalFilings)} matching records.</span></li>
                  <li>
                    <Check className={styles.statusDot} aria-hidden="true" />
                    <span>
                      Recent-record response returned {formatCount(result.recordsReturned)} rows
                      {result.recordsTruncated ? " and is truncated" : " and is complete"}; {formatCount(recordsShown.length)} are displayed here.
                    </span>
                  </li>
                  <li><Info className={`${styles.statusDot} ${styles.infoDot}`} aria-hidden="true" /><span>A recorded zero is different from an unavailable lookup.</span></li>
                </ul>
                <h3 className={styles.panelTitle}>Value key</h3>
                <div className={styles.valueKey}>
                  <div className={styles.valueKeyRow}><span className={styles.keySquare} /><strong>0</strong><span>Valid zero (the source recorded zero).</span></div>
                  <div className={styles.valueKeyRow}><span className={`${styles.keySquare} ${styles.naSquare}`} /><strong>N/A</strong><span>Unavailable (no usable value provided).</span></div>
                </div>
                <p className={styles.chartNote}>
                  Source refresh: {formatPermitAreaDate(result.sourceRefresh.asOf)}.
                </p>
              </aside>
            </div>
          </>
        ) : null}

        <section className={styles.interpretation} aria-label="Interpretation">
          <article>
            <h2>What this suggests</h2>
            <p>{suggests}</p>
          </article>
          <article>
            <h2>What this cannot prove</h2>
            <p>
              These records do not establish construction start, completion, current activity,
              occupancy, code compliance, or project value. Filings may be amended, withdrawn,
              or superseded, and no record does not imply that no work occurred.
            </p>
          </article>
        </section>

        <footer className={styles.actionBar}>
          <div className={styles.actionGroup}>
            <button
              className={styles.button}
              type="button"
              disabled={!result}
              onClick={downloadBrief}
            >
              Download data brief
            </button>
          </div>
          <p className={styles.sourceNote}>Aggregate summary and recent-record ledger use distinct, explicit denominators</p>
          <div className={styles.actionGroup}>
            <button
              className={`${styles.button} ${styles.primaryButton}`}
              type="button"
              onClick={() => openDialog(sourceDialogRef)}
            >
              Verify permit records
            </button>
          </div>
        </footer>
      </div>

      <PermitRecordDialog
        dialogRef={recordDialogRef}
        record={selectedRecord}
        sourceUrl={result?.source.url ?? "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data"}
      />

      <dialog ref={sourceDialogRef} className={styles.dialog} aria-labelledby="permit-source-title">
        <div className={styles.dialogHead}>
          <div>
            <span className={styles.dialogKicker}>Official publisher</span>
            <h2 id="permit-source-title">Verify Chicago permit records</h2>
          </div>
          <button
            className={styles.dialogClose}
            type="button"
            onClick={() => closeDialog(sourceDialogRef)}
            aria-label="Close permit source dialog"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className={styles.dialogBody}>
          <p>
            This brief tabulates records returned by the Explorer&apos;s existing permit-area
            endpoint for the official {area.name} community-area boundary. Verify individual
            filings with the City of Chicago publisher.
          </p>
          <div className={styles.officialLinks}>
            <a
              className={styles.officialLink}
              href={result?.source.url ?? "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu/about_data"}
              target="_blank"
              rel="noreferrer"
            >
              City of Chicago Building Permits dataset
              <ExternalLink aria-hidden="true" />
            </a>
            <a
              className={styles.officialLink}
              href={result?.source.portalUrl ?? "https://webapps1.chicago.gov/buildingrecords/"}
              target="_blank"
              rel="noreferrer"
            >
              Chicago building permit records portal
              <ExternalLink aria-hidden="true" />
            </a>
          </div>
          <p className={styles.chartNote}>
            Publisher links open in a new tab. Returning here preserves the selected
            neighborhood brief.
          </p>
        </div>
      </dialog>

      <div
        className={`${styles.toast} ${toast ? styles.toastVisible : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </div>
  );
}
