"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/* ── Types ─────────────────────────────────────── */

interface Probe {
  name: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface CacheNamespace {
  id: string;
  label: string;
  pattern: string;
  description: string;
}

interface TableStat {
  table: string;
  rows: number | string;
  columns: number;
  sizeBytes: number;
  sizeMB: string;
}

interface VacantStats {
  total: number;
  withIncentives: number;
  withOwnership: number;
  oldestUpdate: string;
  newestUpdate: string;
  ownerTypes: number;
}

interface DataFreshness {
  vacantProperties?: VacantStats;
  ownerTypeBreakdown?: { type: string; count: number }[];
  zones?: { key: string; features: number }[];
  businesses?: { total: number };
  censusTracts?: { total: number };
  programs?: { total: number };
  communityAssets?: { type: string; count: number }[];
}

interface HealthReport {
  status: "healthy" | "degraded" | "critical";
  timestamp: string;
  totalLatencyMs: number;
  probes: Probe[];
  environment: Record<string, boolean>;
  database: { tables: TableStat[] } | { error: string };
  data: DataFreshness | { error: string };
}

/* ── Helpers ───────────────────────────────────── */

const STATUS_COLORS = {
  ok: "#059669",
  healthy: "#059669",
  degraded: "#D97706",
  down: "#DC2626",
  critical: "#DC2626",
} as const;

const STATUS_BG = {
  ok: "#05966910",
  healthy: "#05966910",
  degraded: "#D9770610",
  down: "#DC262610",
  critical: "#DC262610",
} as const;

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || "#9CA3AF";
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}60` }}
    />
  );
}

function Badge({ status }: { status: string }) {
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || "#9CA3AF";
  const bg = STATUS_BG[status as keyof typeof STATUS_BG] || "#9CA3AF10";
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-bold"
      style={{ color, backgroundColor: bg, border: `1px solid ${color}30` }}
    >
      {status}
    </span>
  );
}

function LatencyBar({ ms, max = 8000 }: { ms: number; max?: number }) {
  const pct = Math.min(100, (ms / max) * 100);
  const color = ms < 500 ? "#059669" : ms < 2000 ? "#D97706" : "#DC2626";
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-1.5 bg-[#0C1B33]/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-mono text-[#0C1B33]/50">{ms}ms</span>
    </div>
  );
}

/* ── Control Room ──────────────────────────────── */

export default function AdminControlRoom() {
  const [key, setKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [cacheNamespaces, setCacheNamespaces] = useState<CacheNamespace[]>([]);
  const [clearingCache, setClearingCache] = useState<Record<string, boolean>>({});
  const [cacheResults, setCacheResults] = useState<Record<string, { deleted: number; time: string }>>({});
  const [reprobingService, setReprobingService] = useState<string | null>(null);

  const fetchHealth = useCallback(
    async (secret?: string) => {
      const k = secret || key;
      if (!k) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/health", {
          headers: { "x-admin-key": k },
        });
        if (res.status === 401) {
          setError("Invalid access key");
          setAuthenticated(false);
          return;
        }
        if (res.status === 503) {
          setError("Admin access is not configured");
          setAuthenticated(false);
          return;
        }
        const data: HealthReport = await res.json();
        setReport(data);
        setAuthenticated(true);
        setLastChecked(new Date().toLocaleTimeString());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fetch failed");
      } finally {
        setLoading(false);
      }
    },
    [key]
  );

  // Fetch available cache namespaces
  const fetchCacheNamespaces = useCallback(
    async (secret?: string) => {
      const k = secret || key;
      if (!k) return;
      try {
        const res = await fetch("/api/health/reset", {
          headers: { "x-admin-key": k },
        });
        if (res.ok) {
          const data = await res.json();
          setCacheNamespaces(data.namespaces || []);
        }
      } catch { /* silent */ }
    },
    [key]
  );

  // Clear cache for specific namespaces
  const clearCache = useCallback(
    async (targets: string[]) => {
      if (!key) return;
      const loadingKey = targets.join(",");
      setClearingCache((prev) => ({ ...prev, [loadingKey]: true }));
      try {
        const res = await fetch("/api/health/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-key": key },
          body: JSON.stringify(
            targets.length === cacheNamespaces.length
              ? { action: "clear-all" }
              : { action: "clear-cache", targets }
          ),
        });
        if (res.ok) {
          const data = await res.json();
          const now = new Date().toLocaleTimeString();
          if (data.results) {
            const newResults: Record<string, { deleted: number; time: string }> = {};
            for (const [ns, count] of Object.entries(data.results)) {
              newResults[ns] = { deleted: count as number, time: now };
            }
            setCacheResults((prev) => ({ ...prev, ...newResults }));
          }
        }
      } catch { /* silent */ }
      setClearingCache((prev) => ({ ...prev, [loadingKey]: false }));
    },
    [key, cacheNamespaces.length]
  );

  // Re-probe a single service (just re-runs the full health check)
  const reprobeService = useCallback(
    async (serviceName: string) => {
      setReprobingService(serviceName);
      await fetchHealth();
      setReprobingService(null);
    },
    [fetchHealth]
  );

  // Fetch cache namespaces once authenticated
  useEffect(() => {
    if (authenticated && key) {
      fetchCacheNamespaces();
    }
  }, [authenticated, key, fetchCacheNamespaces]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && authenticated) {
      intervalRef.current = setInterval(() => fetchHealth(), 30000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [autoRefresh, authenticated, fetchHealth]);

  // Check URL for key param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get("key");
    if (urlKey) {
      setKey(urlKey);
      fetchHealth(urlKey);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Login screen
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#0C1B33] flex items-center justify-center">
        <div className="w-full max-w-sm p-8">
          <div className="text-center mb-8">
            <div className="font-mono text-[10px] tracking-[0.4em] uppercase text-emerald-500/60 mb-2">
              SECCC Incentive Explorer
            </div>
            <h1 className="text-xl font-semibold text-white/90">Control Room</h1>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fetchHealth();
            }}
            className="space-y-4"
          >
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Access key"
              autoFocus
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white/90 placeholder:text-white/30 font-mono text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
            <button
              type="submit"
              disabled={loading || !key}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-white/10 text-white font-mono text-sm tracking-wider uppercase rounded-lg transition-colors"
            >
              {loading ? "Connecting..." : "Enter"}
            </button>
            {error && (
              <p className="text-red-400 text-xs text-center font-mono">{error}</p>
            )}
          </form>
        </div>
      </div>
    );
  }

  const r = report!;
  const dbTables =
    "tables" in r.database ? (r.database as { tables: TableStat[] }).tables : null;
  const dataFreshness: DataFreshness | null = "error" in r.data ? null : r.data;

  return (
    <div className="min-h-screen bg-[#0A0F1C] text-white/90">
      {/* Header */}
      <div className="border-b border-white/5 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <div className="font-mono text-[9px] tracking-[0.4em] uppercase text-emerald-500/50">
                Control Room
              </div>
              <h1 className="text-lg font-semibold text-white/90">
                System Health Monitor
              </h1>
            </div>
            <Badge status={r.status} />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={() => setAutoRefresh((v) => !v)}
                className="accent-emerald-500"
              />
              <span className="text-[11px] text-white/40 font-mono">Auto 30s</span>
            </label>
            {lastChecked && (
              <span className="text-[10px] text-white/30 font-mono">
                Last: {lastChecked}
              </span>
            )}
            <button
              onClick={() => fetchHealth()}
              disabled={loading}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-mono tracking-wider uppercase transition-colors disabled:opacity-50"
            >
              {loading ? "Probing..." : "Run Check"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Overview Row */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Overall Status"
            value={r.status.toUpperCase()}
            color={STATUS_COLORS[r.status]}
          />
          <StatCard
            label="Total Probe Time"
            value={`${r.totalLatencyMs}ms`}
            color={r.totalLatencyMs < 3000 ? "#059669" : "#D97706"}
          />
          <StatCard
            label="Services Up"
            value={`${r.probes.filter((p) => p.status === "ok").length}/${r.probes.length}`}
            color={
              r.probes.every((p) => p.status === "ok")
                ? "#059669"
                : "#D97706"
            }
          />
          <StatCard
            label="Checked"
            value={new Date(r.timestamp).toLocaleTimeString()}
            color="#6B7280"
          />
        </div>

        {/* Service Health Grid */}
        <section>
          <SectionTitle>External Services</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {r.probes.map((probe) => (
              <div
                key={probe.name}
                className="bg-white/[0.03] border border-white/5 rounded-lg p-4 hover:border-white/10 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusDot status={probe.status} />
                    <span className="text-[12px] font-medium text-white/80">
                      {probe.name}
                    </span>
                  </div>
                  <Badge status={probe.status} />
                </div>
                <LatencyBar ms={probe.latencyMs} />
                {probe.message && (
                  <p className="mt-2 text-[10px] font-mono text-red-400/70 truncate">
                    {probe.message}
                  </p>
                )}
                <button
                  onClick={() => reprobeService(probe.name)}
                  disabled={reprobingService === probe.name}
                  className="mt-2 w-full py-1 text-[9px] font-mono uppercase tracking-wider text-white/30 hover:text-white/60 hover:bg-white/5 border border-white/5 rounded transition-colors disabled:opacity-30"
                >
                  {reprobingService === probe.name ? "Probing..." : "Re-probe"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Environment Config */}
        <section>
          <SectionTitle>Environment Configuration</SectionTitle>
          <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(r.environment).map(([envVar, isSet]) => (
                <div key={envVar} className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: isSet ? "#059669" : "#DC2626",
                    }}
                  />
                  <span className="text-[11px] font-mono text-white/50">
                    {envVar}
                  </span>
                  <span
                    className="text-[9px] font-mono ml-auto"
                    style={{ color: isSet ? "#059669" : "#DC2626" }}
                  >
                    {isSet ? "SET" : "MISSING"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cache Management */}
        {cacheNamespaces.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Cache Management</SectionTitle>
              <button
                onClick={() => clearCache(cacheNamespaces.map((ns) => ns.id))}
                disabled={!!clearingCache[cacheNamespaces.map((ns) => ns.id).join(",")]}
                className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-red-400/70 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors disabled:opacity-30"
              >
                {clearingCache[cacheNamespaces.map((ns) => ns.id).join(",")]
                  ? "Clearing..."
                  : "Purge All Cache"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {cacheNamespaces.map((ns) => (
                <div
                  key={ns.id}
                  className="bg-white/[0.03] border border-white/5 rounded-lg p-3 hover:border-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-white/70">
                      {ns.label}
                    </span>
                    <span className="text-[9px] font-mono text-white/20">
                      {ns.pattern}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/30 mb-2">{ns.description}</p>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => clearCache([ns.id])}
                      disabled={!!clearingCache[ns.id]}
                      className="px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/20 rounded transition-colors disabled:opacity-30"
                    >
                      {clearingCache[ns.id] ? "Clearing..." : "Clear"}
                    </button>
                    {cacheResults[ns.id] && (
                      <span className="text-[9px] font-mono text-emerald-500/50">
                        {cacheResults[ns.id].deleted} keys cleared at{" "}
                        {cacheResults[ns.id].time}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Database Tables */}
        {dbTables && (
          <section>
            <SectionTitle>Database Tables</SectionTitle>
            <div className="bg-white/[0.03] border border-white/5 rounded-lg overflow-hidden">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left px-4 py-2.5 text-white/30 font-medium uppercase tracking-wider text-[9px]">
                      Table
                    </th>
                    <th className="text-right px-4 py-2.5 text-white/30 font-medium uppercase tracking-wider text-[9px]">
                      Rows
                    </th>
                    <th className="text-right px-4 py-2.5 text-white/30 font-medium uppercase tracking-wider text-[9px]">
                      Columns
                    </th>
                    <th className="text-right px-4 py-2.5 text-white/30 font-medium uppercase tracking-wider text-[9px]">
                      Size
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dbTables.map((t) => (
                    <tr
                      key={t.table}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-2 text-emerald-400/80">{t.table}</td>
                      <td className="px-4 py-2 text-right text-white/60">
                        {typeof t.rows === "number"
                          ? t.rows.toLocaleString()
                          : t.rows}
                      </td>
                      <td className="px-4 py-2 text-right text-white/40">{t.columns}</td>
                      <td className="px-4 py-2 text-right text-white/40">
                        {t.sizeMB} MB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Data Freshness */}
        {dataFreshness && (
          <section>
            <SectionTitle>Data Freshness &amp; Coverage</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Vacant Properties */}
              {dataFreshness.vacantProperties && (
                <DataCard title="Vacant Properties">
                  <div className="space-y-1.5">
                    <DataRow label="Total" value={dataFreshness.vacantProperties.total.toLocaleString()} />
                    <DataRow
                      label="With Incentives"
                      value={`${dataFreshness.vacantProperties.withIncentives.toLocaleString()} (${((dataFreshness.vacantProperties.withIncentives / dataFreshness.vacantProperties.total) * 100).toFixed(1)}%)`}
                      color="#059669"
                    />
                    <DataRow
                      label="With Ownership"
                      value={`${dataFreshness.vacantProperties.withOwnership.toLocaleString()} (${((dataFreshness.vacantProperties.withOwnership / dataFreshness.vacantProperties.total) * 100).toFixed(1)}%)`}
                      color="#7C3AED"
                    />
                    <DataRow
                      label="Last Sync"
                      value={new Date(dataFreshness.vacantProperties.newestUpdate).toLocaleString()}
                    />
                  </div>
                </DataCard>
              )}

              {/* Owner Type Breakdown */}
              {dataFreshness.ownerTypeBreakdown && (
                <DataCard title="Owner Type Distribution">
                  <div className="space-y-1.5">
                    {dataFreshness.ownerTypeBreakdown.map((o) => (
                      <DataRow
                        key={o.type}
                        label={o.type}
                        value={o.count.toLocaleString()}
                      />
                    ))}
                  </div>
                </DataCard>
              )}

              {/* Zones */}
              {dataFreshness.zones && (
                <DataCard title="Zone Layers">
                  <div className="space-y-1.5">
                    {dataFreshness.zones.map((z) => (
                      <DataRow
                        key={z.key}
                        label={z.key}
                        value={`${z.features.toLocaleString()} features`}
                      />
                    ))}
                  </div>
                </DataCard>
              )}

              {/* Other Data */}
              <DataCard title="Other Data">
                <div className="space-y-1.5">
                  {dataFreshness.businesses && (
                    <DataRow
                      label="Businesses"
                      value={dataFreshness.businesses.total.toLocaleString()}
                    />
                  )}
                  {dataFreshness.censusTracts && (
                    <DataRow
                      label="Census Tracts"
                      value={dataFreshness.censusTracts.total.toLocaleString()}
                    />
                  )}
                  {dataFreshness.programs && (
                    <DataRow
                      label="Programs"
                      value={dataFreshness.programs.total.toLocaleString()}
                    />
                  )}
                  {dataFreshness.communityAssets &&
                    dataFreshness.communityAssets.map((a) => (
                      <DataRow
                        key={a.type}
                        label={`Assets: ${a.type}`}
                        value={a.count.toLocaleString()}
                      />
                    ))}
                </div>
              </DataCard>
            </div>
          </section>
        )}

        {/* Raw JSON (collapsible) */}
        <details className="group">
          <summary className="cursor-pointer text-[10px] font-mono text-white/20 hover:text-white/40 uppercase tracking-wider transition-colors">
            Raw JSON Response
          </summary>
          <pre className="mt-2 p-4 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] font-mono text-white/40 overflow-x-auto max-h-[400px] overflow-y-auto">
            {JSON.stringify(r, null, 2)}
          </pre>
        </details>

        {/* Footer */}
        <div className="text-center py-8 text-[10px] font-mono text-white/15">
          SECCC Incentive Explorer — Control Room — Not for public access
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────── */

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
      <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/30 mb-1">
        {label}
      </div>
      <div className="text-lg font-semibold font-mono" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/25 mb-3">
      {children}
    </h2>
  );
}

function DataCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-4">
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-500/50 mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

function DataRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-white/40">{label}</span>
      <span
        className="text-[11px] font-mono"
        style={{ color: color || "rgba(255,255,255,0.7)" }}
      >
        {value}
      </span>
    </div>
  );
}
