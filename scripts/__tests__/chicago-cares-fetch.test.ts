import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChicagoCaresContractQueryUrl } from "../../lib/chicago-cares-program-ledger";
import {
  fetchChicagoCaresProgramLedgerSources,
  importChicagoCaresProgramLedger,
} from "../import-chicago-cares-program-ledger";

const TARGET = getChicagoCaresContractQueryUrl("togetherNow");
const contractFields = [
  "purchase_order_description", "purchase_order_contract_number", "revision_number",
  "specification_number", "contract_type", "approval_date", "department", "vendor_name",
  "vendor_id", "address_1", "city", "state", "zip", "award_amount",
];
const grantFields = [
  "data_extract_as_of_date", "department_code", "department_description", "fund_code",
  "parent_cost_center_code", "grant_project_code", "grant_project_description",
  "grant_start_date", "grant_end_date", "grant_agency", "aln_code", "budget",
  "encumbrances", "expended_project_to_date", "record_id",
];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function healthyResponse(url: string): Response {
  if (!url.includes("/api/views/")) return json([]);
  const id = url.split("/").at(-1);
  const fields = id === "rsxa-ify5" ? contractFields : grantFields;
  return json({ id, rowsUpdatedAt: 1_793_600_000, columns: fields.map(fieldName => ({ fieldName })) });
}

type RequestHandler = (url: string, init: RequestInit | undefined, attempt: number) => Response | Promise<Response>;

function mockRequests(handler: RequestHandler) {
  const counts = new Map<string, number>();
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const attempt = (counts.get(url) ?? 0) + 1;
    counts.set(url, attempt);
    return Promise.resolve().then(() => handler(url, init, attempt));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { counts, fetchMock };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Chicago CARES source fetching", () => {
  it("retries only the failed request and retains the exact bounded URL and deadline signal", async () => {
    const { counts, fetchMock } = mockRequests((url, _init, attempt) => {
      if (url === TARGET && attempt === 1) throw new TypeError("fetch failed");
      return healthyResponse(url);
    });
    const pending = fetchChicagoCaresProgramLedgerSources();
    await vi.runAllTimersAsync();
    const sources = await pending;

    expect(sources.contractRows.togetherNow).toEqual([]);
    expect(counts.size).toBe(7);
    expect(counts.get(TARGET)).toBe(2);
    expect([...counts.entries()].filter(([url]) => url !== TARGET).every(([, count]) => count === 1)).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([408, 429, 500, 503])("bounds transient HTTP %s failures to three attempts", async status => {
    const { counts } = mockRequests(url => url === TARGET
      ? new Response("unavailable", { status })
      : healthyResponse(url));
    const pending = fetchChicagoCaresProgramLedgerSources().catch(error => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error.message).toContain("after 3 attempt(s)");
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).toContain(TARGET);
    expect(counts.get(TARGET)).toBe(3);
  });

  it.each([400, 401, 403, 404])("does not retry permanent HTTP %s failures", async status => {
    const { counts } = mockRequests(url => url === TARGET
      ? new Response("rejected", { status })
      : healthyResponse(url));
    await expect(fetchChicagoCaresProgramLedgerSources()).rejects.toThrow(`HTTP ${status}`);
    expect(counts.get(TARGET)).toBe(1);
  });

  it("honors a short Retry-After and does not retry before it expires", async () => {
    const { counts } = mockRequests((url, _init, attempt) => url === TARGET && attempt === 1
      ? new Response("slow down", { status: 429, headers: { "retry-after": "2" } })
      : healthyResponse(url));
    const pending = fetchChicagoCaresProgramLedgerSources();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(counts.get(TARGET)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(counts.get(TARGET)).toBe(2);
  });

  it("fails rather than retrying early when Retry-After exceeds the bounded wait", async () => {
    const { counts } = mockRequests(url => url === TARGET
      ? new Response("slow down", { status: 429, headers: { "retry-after": "120" } })
      : healthyResponse(url));
    await expect(fetchChicagoCaresProgramLedgerSources()).rejects.toThrow("Retry-After: 120");
    expect(counts.get(TARGET)).toBe(1);
  });

  it("bounds hung requests, retries, and names the timed-out query", async () => {
    const { counts } = mockRequests((url, init) => url === TARGET
      ? new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })
      : healthyResponse(url));
    const pending = fetchChicagoCaresProgramLedgerSources().catch(error => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error.message).toContain("timed out after 20000ms");
    expect(error.message).toContain(TARGET);
    expect(counts.get(TARGET)).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the timeout active while reading a response body", async () => {
    const { counts } = mockRequests((url, init) => {
      if (url !== TARGET) return healthyResponse(url);
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new DOMException("body aborted", "AbortError")), { once: true });
        }),
      } as Response;
    });
    const pending = fetchChicagoCaresProgramLedgerSources().catch(error => error);
    await vi.runAllTimersAsync();
    expect((await pending).message).toContain("timed out after 20000ms");
    expect(counts.get(TARGET)).toBe(3);
  });

  it.each(["content type", "JSON syntax"])("fails closed without retrying invalid %s", async kind => {
    const { counts } = mockRequests(url => url === TARGET
      ? kind === "content type"
        ? new Response("<html>oops</html>", { headers: { "content-type": "text/html" } })
        : new Response("{invalid", { headers: { "content-type": "application/json" } })
      : healthyResponse(url));
    await expect(fetchChicagoCaresProgramLedgerSources()).rejects.toThrow(TARGET);
    expect(counts.get(TARGET)).toBe(1);
  });

  it("still refuses a potentially truncated bounded query", async () => {
    const { counts } = mockRequests(url => url === TARGET ? json(Array(5_000).fill({})) : healthyResponse(url));
    await expect(fetchChicagoCaresProgramLedgerSources()).rejects.toThrow("5000-row safety bound");
    expect(counts.get(TARGET)).toBe(1);
  });

  it("still rejects dataset schema drift after a successful request", async () => {
    mockRequests(url => url.endsWith("/api/views/rsxa-ify5")
      ? json({ id: "rsxa-ify5", rowsUpdatedAt: 1_793_600_000, columns: [] })
      : healthyResponse(url));
    await expect(fetchChicagoCaresProgramLedgerSources()).rejects.toThrow("missing fields: purchase_order_description");
  });

  it("preserves the old CSV on exhausted transport failures and records the nested cause", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cares-fetch-failure-"));
    const output = join(directory, "ledger.csv");
    writeFileSync(output, "previous verified ledger\n");
    mockRequests(url => {
      if (url === TARGET) {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }) });
      }
      return healthyResponse(url);
    });
    try {
      const pending = importChicagoCaresProgramLedger({ input: null, output }).catch(error => error);
      await vi.runAllTimersAsync();
      const error = await pending;
      expect(error.message).toContain("ETIMEDOUT");
      expect(error.message).toContain("connect timeout");
      expect(error.message).toContain(TARGET);
      expect(readFileSync(output, "utf8")).toBe("previous verified ledger\n");
      expect(readdirSync(directory)).toEqual(["ledger.csv"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
