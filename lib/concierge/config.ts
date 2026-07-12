/**
 * Site Concierge — Stage 1 configuration & feature gating.
 *
 * The concierge is FEATURE-FLAGGED OFF by default. It only comes alive when
 * BOTH of these are true:
 *   - CONCIERGE_ENABLED === "true"
 *   - AI_GATEWAY_API_KEY is present (the Vercel AI Gateway credential)
 *
 * With no keys provisioned the endpoint 503s with a friendly payload and the
 * UI panel never renders. This keeps the PR safe to merge into an environment
 * that has no gateway key.
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

/** Rate limits (design note §4/6). Documented as per-instance best-effort. */
export const CONCIERGE_RATE_LIMITS = {
  /** Per-IP message cap within the rolling window. */
  perIpPerHour: 20,
  /** Per-session (cookie) message cap within the rolling window. */
  perSessionPerDay: 40,
} as const;

/** Default per-day GLOBAL message cap (design note §6 daily budget). */
export const DEFAULT_CONCIERGE_DAILY_BUDGET = 500;

/**
 * Global daily message budget (env CONCIERGE_DAILY_BUDGET, default 500). Enforced
 * in the route across all users/sessions. A safety valve on total spend, distinct
 * from the per-IP / per-session throttles. Non-numeric or non-positive values fall
 * back to the default so a bad env can never disable the cap silently.
 */
export function getConciergeDailyBudget(): number {
  const raw = process.env.CONCIERGE_DAILY_BUDGET?.trim();
  if (!raw) return DEFAULT_CONCIERGE_DAILY_BUDGET;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONCIERGE_DAILY_BUDGET;
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

/**
 * True only when the operator has explicitly turned the concierge on AND a
 * gateway key is available. Read by both the API route (to 503) and the UI
 * (via /api/concierge/status) so the panel can stay hidden with no keys.
 */
export function isConciergeEnabled(): boolean {
  return process.env.CONCIERGE_ENABLED === "true" && getGatewayApiKey() !== null;
}
