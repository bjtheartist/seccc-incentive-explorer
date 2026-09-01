// ─── Support-lead capture (email-gate redesign, spec §D) ────────────────
// The gate's optional "Want a hand?" box promises: "A real person from the
// Southeast Chicago Chamber of Commerce will follow up within 48 hours."
// This routes that opt-in through the SAME lead-capture path
// app/api/email-report/route.ts already uses for its `wantsHelp` branch
// (lib/report-email-delivery.ts's createReportLead + a Resend notification
// to the chamber's existing INCENTIVE_HELP_INBOX) — but without also
// emailing the visitor their report, since the gate's promise here is only
// the 48-hour follow-up, never report delivery (that stays inside the
// report itself, per the gate footer). No new outbound mechanism is
// invented: same DB table, same Resend client, same inbox env var.

export interface SupportRequestInput {
  name?: string;
  email: string;
  address?: string;
  reportTitle?: string;
  reportType?: string;
  projectGoal?: string;
  source: string;
  /** Honeypot field — non-empty means a bot filled a field real visitors never see. */
  website?: string;
}

export interface SupportRequestResponse {
  success?: boolean;
  error?: string;
  /** Whether a chamber-inbox notification was actually sent (false when Resend/inbox env vars are unset — the lead is still captured either way). */
  notified?: boolean;
  /**
   * Owner ruling (2026-09-01): when `notified` is false and the help inbox is
   * configured, the server hands back the address so the visitor can be told
   * to email the Chamber directly instead of trusting a follow-up that was
   * never actually dispatched.
   */
  contact?: string;
}

export async function submitSupportRequest(
  input: SupportRequestInput,
): Promise<SupportRequestResponse> {
  const response = await fetch("/api/support-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Gate review round 1, BLOCKER 3: the caller awaits this before any
    // navigation or unmount, but `keepalive` is cheap defense-in-depth
    // against a browser aborting in-flight requests on page transition —
    // the payload is small JSON (no PDF), well within the keepalive body
    // limit.
    keepalive: true,
    body: JSON.stringify({
      name: input.name?.trim() || undefined,
      email: input.email.trim().toLowerCase(),
      address: input.address,
      reportTitle: input.reportTitle,
      reportType: input.reportType,
      projectGoal: input.projectGoal,
      source: input.source,
      website: input.website || "",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as SupportRequestResponse;
  if (!response.ok || !body.success) {
    throw new Error(body.error || "We could not send your request. Please try again.");
  }
  return body;
}
