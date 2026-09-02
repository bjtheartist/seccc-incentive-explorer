import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import {
  createReportLead,
  markReportLeadNotification,
  ReportEmailStorageUnavailableError,
  type LeadNotificationStatus,
} from "@/lib/report-email-delivery";

export const runtime = "nodejs";

// ─── Support-request lead capture (email-gate redesign, spec §D) ────────
// The gate's optional "Want a hand?" opt-in, submitted separately from
// viewing/saving the report. Reuses the SAME lead table and the SAME
// Resend notification mechanism app/api/email-report/route.ts already
// uses for its `wantsHelp` branch — this route just skips generating and
// emailing a PDF to the visitor, since the only promise this box makes is
// the 48-hour chamber follow-up, not report delivery.

const SupportRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(120).optional(),
  address: z.string().trim().max(320).optional(),
  reportTitle: z.string().trim().max(180).optional(),
  reportType: z.string().trim().max(80).optional(),
  projectGoal: z.string().trim().max(360).optional(),
  source: z.string().trim().max(100).optional().default("report_email_gate_support"),
  website: z.string().max(200).optional().default(""),
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}

function supportNotificationHtml(input: z.infer<typeof SupportRequestSchema>): string {
  const name = escapeHtml(input.name || "Report visitor");
  const email = escapeHtml(input.email);
  const address = escapeHtml(input.address || "Not provided");
  const goal = escapeHtml(input.projectGoal || "Not provided");
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; color: #0C1B33;">
      <h1 style="font-size: 20px;">1-on-1 support requested</h1>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Address:</strong> ${address}</p>
      <p><strong>Project goals:</strong> ${goal}</p>
      <p>Requested from the report email gate's optional support box. The visitor was told a real person would follow up within 48 hours.</p>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => null);
  const parsed = SupportRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const input = parsed.data;

  // Honeypot submissions receive a neutral success response without any write.
  if (input.website) {
    return NextResponse.json({ success: true, notified: false });
  }

  let leadId: number;
  try {
    leadId = await createReportLead({
      name: input.name,
      email: input.email,
      reportAddress: input.address,
      reportTitle: input.reportTitle,
      reportType: input.reportType,
      projectGoal: input.projectGoal,
      wantsHelp: true,
      source: input.source,
    });
  } catch (error) {
    if (error instanceof ReportEmailStorageUnavailableError) {
      return NextResponse.json(
        { error: "Support requests are temporarily unavailable." },
        { status: 503 },
      );
    }
    console.error("Support request lead capture failed:", error);
    return NextResponse.json(
      { error: "We could not send your request. Please try again." },
      { status: 502 },
    );
  }

  // Audit finding 3: `notified: false` used to conflate two very different
  // states — a send that genuinely failed, and an environment where no send
  // was ever configured. On a preview deploy (or during a prod env rotation)
  // the second state made every visitor read "our alert did not go through",
  // which was both alarming and untrue. They are now distinct: only `failed`
  // is a broken promise the visitor needs to hear about.
  let notificationState: LeadNotificationStatus = "unconfigured";
  let notificationError: string | undefined;

  if (!process.env.RESEND_API_KEY || !process.env.INCENTIVE_HELP_INBOX) {
    // Still recorded and still logged — a lead nobody was told about is a
    // deployment problem, it just is not the visitor's problem.
    console.warn(
      "Support request notification skipped: RESEND_API_KEY and/or INCENTIVE_HELP_INBOX is not configured",
    );
  } else {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const delivery = await resend.emails.send({
        from: process.env.REPORT_EMAIL_FROM
          || "Chicago Incentive Explorer <reports@chicagoincentiveexplorer.com>",
        to: [process.env.INCENTIVE_HELP_INBOX],
        replyTo: input.email,
        subject: `Support requested - ${input.address || input.email}`,
        html: supportNotificationHtml(input),
        text: `1-on-1 support requested\n\nName: ${input.name || "Report visitor"}\nEmail: ${input.email}\nAddress: ${input.address || "Not provided"}\nProject goals: ${input.projectGoal || "Not provided"}`,
      });
      if (delivery.error) {
        notificationState = "failed";
        notificationError = delivery.error.message || "Resend rejected the notification";
        console.error("Support request notification was not accepted by Resend");
      } else {
        notificationState = "sent";
      }
    } catch (caught) {
      notificationState = "failed";
      notificationError = caught instanceof Error ? caught.message : String(caught);
      console.error("Support request notification failed:", caught);
    }
  }

  // Audit finding 1: the miss must leave a durable record. Before this, a
  // failed alert produced a console.error and a lead row indistinguishable
  // from a delivered one — six leads lost to a 20-minute Resend outage would
  // have been unfindable. Staff can now query
  // `notification_status <> 'sent'`. A metadata write that itself fails must
  // not turn a captured lead into an error response, so it is logged, not
  // thrown.
  try {
    await markReportLeadNotification(leadId, notificationState, notificationError);
  } catch (statusError) {
    console.error(
      `Support request notification status was not recorded for lead ${leadId} (${notificationState}):`,
      statusError,
    );
  }

  // Owner ruling (Billy, 2026-09-01): a missed Chamber notification must fail
  // LOUDLY at the visitor, not dissolve into a silent 200 — the gate promised
  // a real person within 48 hours, and the lead row alone doesn't guarantee a
  // person sees it in time. When the help inbox is configured we also hand the
  // client the address so its copy can say "email us directly" with a real
  // destination instead of a dead-end apology. The inbox exists precisely to
  // receive these requests, so returning it discloses nothing sensitive. It is
  // returned only on a genuine `failed` — an unconfigured env has no address
  // to give and nothing alarming to say.
  const notified = notificationState === "sent";
  if (notificationState === "failed" && process.env.INCENTIVE_HELP_INBOX) {
    return NextResponse.json({
      success: true,
      notified,
      notificationState,
      contact: process.env.INCENTIVE_HELP_INBOX,
    });
  }
  return NextResponse.json({ success: true, notified, notificationState });
}
