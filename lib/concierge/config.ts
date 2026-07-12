/**
 * Site Concierge — Stage 1 configuration & feature gating.
 *
 * The guide is FEATURE-FLAGGED OFF by default. CONCIERGE_ENABLED turns on the
 * sourced deterministic guide. An AI Gateway key or Vercel deployment OIDC
 * token additionally enables open-model conversations and approval tools.
 *
 * With the flag off, the endpoint 503s and the panel never renders. With the
 * flag on but no model credential, common guidance remains available without
 * any model spend.
 *
 * See docs/concierge-design.md §1 (guest scope) and §2 (boundaries).
 */

/** Default pilot model (see design note §5). Overridable via CONCIERGE_MODEL. */
export const DEFAULT_CONCIERGE_MODEL = "openai/gpt-oss-120b";

/** Multi-step tool-use ceiling for a single request (design note: ~6). */
export const CONCIERGE_MAX_STEPS = 6;

/** Max messages accepted from the client per request. */
export const CONCIERGE_MAX_MESSAGES = 20;

/** Max characters accepted for a single user message. */
export const CONCIERGE_MAX_MESSAGE_CHARS = 2000;

/** Max serialized request body after parsing, including tool/approval parts. */
export const CONCIERGE_MAX_PAYLOAD_CHARS = 100_000;

/** Bound response length and cost without constraining multi-step tool calls. */
export const CONCIERGE_MAX_OUTPUT_TOKENS = 1200;

/** Shared rate limits (Redis, Neon, then local fallback; design note §4/6). */
export const CONCIERGE_RATE_LIMITS = {
  /** Per-IP message cap within the rolling window. */
  perIpPerHour: 20,
  /** Per-session (cookie) message cap within the rolling window. */
  perSessionPerDay: 40,
} as const;

/** Default per-day GLOBAL model-turn cap (design note §6 daily budget). */
export const DEFAULT_CONCIERGE_DAILY_BUDGET = 500;

/** Signed-in conversation audit retention. Guest transcripts are never stored. */
export const DEFAULT_CONCIERGE_RETENTION_DAYS = 90;

/**
 * Global daily model-turn budget (env CONCIERGE_DAILY_BUDGET, default 500).
 * Enforced across all users/sessions. Deterministic turns do not consume it.
 * Non-numeric or non-positive values fall back to the default so a bad env can
 * never disable the cap silently.
 */
export function getConciergeDailyBudget(): number {
  const raw = process.env.CONCIERGE_DAILY_BUDGET?.trim();
  if (!raw) return DEFAULT_CONCIERGE_DAILY_BUDGET;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONCIERGE_DAILY_BUDGET;
  return Math.floor(parsed);
}

export function getConciergeRetentionDays(): number {
  const raw = process.env.CONCIERGE_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_CONCIERGE_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) {
    return DEFAULT_CONCIERGE_RETENTION_DAYS;
  }
  return Math.floor(parsed);
}

export function getConciergeModelId(): string {
  const fromEnv = process.env.CONCIERGE_MODEL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_CONCIERGE_MODEL;
}

export function getGatewayApiKey(): string | null {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/** Vercel deployments use the Gateway package's native OIDC auth path. */
export function hasGatewayCredential(): boolean {
  return Boolean(
    getGatewayApiKey() ||
      process.env.VERCEL_OIDC_TOKEN?.trim() ||
      process.env.VERCEL === "1"
  );
}

/**
 * True only when the operator has explicitly turned the guide on. Model
 * availability is optional because the deterministic, sourced path does not
 * require a Gateway call.
 */
export function isConciergeEnabled(): boolean {
  return process.env.CONCIERGE_ENABLED === "true";
}
