"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import {
  Compass,
  X,
  Send,
  ArrowRight,
  Loader2,
  ShieldCheck,
  Check,
  Ban,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { toApprovalRows } from "@/lib/concierge/approval";
import type { ConciergePageContext } from "@/lib/concierge/types";
import { MarkdownLite } from "./MarkdownLite";

const RESTING_MESSAGE =
  "The concierge is resting right now — you've hit the usage limit for this window. Keep exploring the map, programs, and reports directly, and check back a little later.";

const GREETING_STORAGE_KEY = "seccc_incentive_guide_greeted_v1";

const QUICK_STARTS = [
  { label: "Improve my space", prompt: "I want to improve or remodel my space." },
  { label: "Hire employees", prompt: "I want to hire employees." },
  { label: "Buy equipment", prompt: "I want to buy equipment for my business." },
  { label: "Open or relocate", prompt: "I want to open or relocate a business." },
  { label: "Get local support", prompt: "Help me get connected to local support." },
  { label: "Just explore", prompt: "Help me understand what I can explore here." },
] as const;

const TOOL_STATUS: Record<string, string> = {
  searchPrograms: "Checking programs…",
  getProgram: "Reading program details…",
  listZonesAtPoint: "Checking zone coverage…",
  getPageContext: "Reading this page…",
  getWorkspaceOverview: "Reading your Business File…",
  getPreparationPacket: "Reading your packet…",
  navigateTo: "Finding the right page…",
  updateBusinessProfile: "Saving your profile…",
  updatePacketTask: "Updating your packet…",
  createFoundationPacket: "Starting your packet…",
  selectPacketProgram: "Setting the program…",
  prepareSupportRequest: "Preparing your introduction request…",
};

/** Friendly titles for the approval cards (action tools only). */
const ACTION_LABEL: Record<string, string> = {
  updateBusinessProfile: "Update your business profile",
  updatePacketTask: "Update a packet task",
  createFoundationPacket: "Start an Incentive Preparedness Packet",
  selectPacketProgram: "Set your packet's program",
  prepareSupportRequest: "Prepare an introduction request",
};

const ACTION_TOOL_NAMES = new Set(Object.keys(ACTION_LABEL));

interface NavSuggestion {
  route: string;
  label: string;
  reason: string | null;
}

/**
 * Floating trigger + responsive guide panel. Renders only when enabled by the
 * server flag. Guests receive sourced read-only guidance; signed-in owners can
 * approve guarded workspace actions. Hides while any modal dialog is open,
 * including the report page's native <dialog> email gate, so it never fights a
 * blocking dialog and becomes usable the moment the gate resolves.
 */
export function ConciergePanel({
  pageContext,
  suppressed = false,
}: {
  pageContext: ConciergePageContext;
  /** Force-hide the trigger (e.g. report email gate is showing). */
  suppressed?: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const firedRef = useRef<Set<string>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest page context in a ref so callbacks/effects always read the
  // freshest value without re-subscribing. Updated in an effect (never during
  // render).
  const pageContextRef = useRef(pageContext);
  useEffect(() => {
    pageContextRef.current = pageContext;
  }, [pageContext]);

  // 1. Feature flag — panel is invisible with no keys provisioned.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/concierge/status")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => {
        if (!cancelled) setEnabled(Boolean(d?.enabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 3. Offer one quiet, non-blocking greeting per browser. It waits until no
  // other dialog is open and is remembered only after the visitor dismisses it
  // or opens the guide.
  useEffect(() => {
    if (
      enabled !== true ||
      open ||
      dialogOpen ||
      suppressed ||
      showGreeting
    ) {
      return;
    }
    try {
      if (window.localStorage.getItem(GREETING_STORAGE_KEY) === "true") return;
    } catch {
      // Storage can be unavailable in privacy modes; the greeting still works.
    }
    const timer = window.setTimeout(() => setShowGreeting(true), 900);
    return () => window.clearTimeout(timer);
  }, [dialogOpen, enabled, open, showGreeting, suppressed]);

  // 2. Watch the DOM for any open modal dialog and hide the trigger while one
  // is present (the report email gate is a native <dialog open>).
  useEffect(() => {
    const check = () => {
      const found = document.querySelector(
        'dialog[open], [role="dialog"], [aria-modal="true"]'
      );
      setDialogOpen(Boolean(found));
      if (found) setOpen(false);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "role", "aria-modal"],
    });
    return () => observer.disconnect();
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/concierge" }),
    []
  );

  const { messages, sendMessage, status, addToolApprovalResponse } =
    useChat({
      transport,
      // After the user approves/declines a tool, auto-resubmit so the server can
      // run (or skip) the tool and continue the turn.
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  const fireOnce = useCallback(
    (key: string, fn: () => void) => {
      if (firedRef.current.has(key)) return;
      firedRef.current.add(key);
      fn();
    },
    []
  );

  // 4. Exactly-once instrumentation for tool calls + nav suggestions.
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      (message.parts ?? []).forEach((part, i) => {
        const type = (part as { type: string }).type;
        if (!type?.startsWith("tool-")) return;
        const toolName = type.slice("tool-".length);
        const state = (part as { state?: string }).state;
        if (state === "approval-requested" && ACTION_TOOL_NAMES.has(toolName)) {
          fireOnce(`proposed:${message.id}:${i}`, () =>
            trackEvent("concierge_action_proposed", {
              source: pageContextRef.current.route,
              metadata: { tool: toolName },
            })
          );
        }
        if (state === "output-available" || state === "output-error") {
          fireOnce(`tool:${message.id}:${i}`, () =>
            trackEvent("concierge_tool_called", {
              source: pageContextRef.current.route,
              metadata: { tool: toolName },
            })
          );
          const output = (part as { output?: unknown }).output as
            | { ok?: boolean; suggestion?: NavSuggestion }
            | undefined;
          if (toolName === "navigateTo" && output?.ok && output.suggestion) {
            fireOnce(`nav:${message.id}:${i}`, () =>
              trackEvent("concierge_nav_suggested", {
                source: pageContextRef.current.route,
                metadata: { route: output.suggestion!.route },
              })
            );
          }
        }
      });
    }
  }, [messages, fireOnce]);

  useEffect(() => {
    if (!open) return;
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open, status]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const rememberGreeting = useCallback(() => {
    setShowGreeting(false);
    try {
      window.localStorage.setItem(GREETING_STORAGE_KEY, "true");
    } catch {
      // No-op when storage is unavailable.
    }
  }, []);

  const openPanel = useCallback(() => {
    rememberGreeting();
    setOpen(true);
    fireOnce("opened", () =>
      trackEvent("concierge_opened", { source: pageContextRef.current.route })
    );
  }, [fireOnce, rememberGreeting]);

  const sendPrompt = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt || status === "streaming" || status === "submitted") return;
      trackEvent("concierge_message_sent", {
        source: pageContextRef.current.route,
      });
      sendMessage(
        { text: prompt },
        { body: { pageContext: pageContextRef.current } }
      );
    },
    [sendMessage, status]
  );

  const handleSend = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text) return;
      sendPrompt(text);
      setInput("");
    },
    [input, sendPrompt]
  );

  const navigate = useCallback(
    (route: string) => {
      router.push(route);
      setOpen(false);
    },
    [router]
  );

  const handleApproval = useCallback(
    (approvalId: string, toolName: string, approved: boolean) => {
      trackEvent(
        approved ? "concierge_action_approved" : "concierge_action_declined",
        {
          source: pageContextRef.current.route,
          metadata: { tool: toolName },
        }
      );
      void addToolApprovalResponse({ id: approvalId, approved });
    },
    [addToolApprovalResponse]
  );

  if (enabled !== true) return null;

  const busy = status === "streaming" || status === "submitted";
  const showTrigger = !open && !dialogOpen && !suppressed;

  return (
    <>
      {/* Floating trigger */}
      {showTrigger && (
        <div className="fixed bottom-4 right-4 z-[70] flex items-end gap-3 print:hidden sm:bottom-5 sm:right-5">
          {showGreeting && (
            <div className="relative w-[min(270px,calc(100vw-88px))] border border-[#0C1B33]/15 bg-white px-4 py-3 pr-9 shadow-xl">
              <button
                type="button"
                onClick={rememberGreeting}
                aria-label="Dismiss greeting"
                title="Dismiss"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center text-[#0C1B33]/45 hover:text-[#0C1B33]"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={openPanel}
                className="block text-left text-[13px] leading-5 text-[#0C1B33]/75"
              >
                <span className="font-medium text-[#0C1B33]">
                  Hi, I&apos;m your Incentive Guide.
                </span>{" "}
                What are you working on today?
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={openPanel}
            aria-label="Open Incentive Guide"
            title="Open Incentive Guide"
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2 border-white bg-[#0C1B33] text-white shadow-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            <Compass className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Slide-over panel */}
      {open && !dialogOpen && !suppressed && (
        <div
          className="fixed inset-x-0 bottom-0 z-[70] flex h-[88dvh] w-full flex-col border-t border-[#0C1B33]/12 bg-white shadow-2xl print:hidden sm:inset-y-0 sm:left-auto sm:right-0 sm:h-auto sm:max-w-md sm:border-l sm:border-t-0"
          role="complementary"
          aria-label="Incentive Guide"
        >
          {/* Header */}
          <header className="flex items-center justify-between border-b border-[#0C1B33]/10 bg-[#0C1B33] px-4 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10">
                <Compass className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-white/55">
                  AI guide
                </p>
                <h2 className="font-editorial text-xl leading-tight">
                  Incentive Guide
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Incentive Guide"
              title="Close"
              className="flex h-9 w-9 items-center justify-center text-white/70 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </header>

          {/* Transcript */}
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="border border-dashed border-[#0C1B33]/15 bg-[#FAF9F6] p-4">
                <p className="font-mono-bureau text-[9px] uppercase tracking-[0.2em] text-[#0C1B33]/40">
                  Start here
                </p>
                <p className="mt-2 text-[14px] font-medium leading-5 text-[#0C1B33]">
                  What are you working on today?
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {QUICK_STARTS.map((choice) => (
                    <button
                      key={choice.label}
                      type="button"
                      onClick={() => sendPrompt(choice.prompt)}
                      disabled={busy}
                      className="flex min-h-10 items-center justify-between gap-2 border border-[#0C1B33]/12 bg-white px-3 py-2 text-left text-[12px] font-medium text-[#0C1B33]/75 transition-colors hover:border-[#2563EB]/40 hover:text-[#0C1B33] disabled:opacity-40"
                    >
                      {choice.label}
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-4 text-[#0C1B33]/45">
                  I can help you explore, prepare, and get connected to local
                  support. Program administrators make eligibility and award
                  decisions.
                </p>
              </div>
            )}

            {messages.map((message) => (
              <ConciergeMessage
                key={message.id}
                message={message}
                onNavigate={navigate}
                onApproval={handleApproval}
              />
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-[#0C1B33]/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="font-mono-bureau text-[10px] uppercase tracking-[0.15em]">
                  Thinking…
                </span>
              </div>
            )}

            {status === "error" && (
              <div
                role="alert"
                className="border border-[#0C1B33]/15 bg-[#FAF9F6] p-3 text-[12px] leading-relaxed text-[#0C1B33]/75"
              >
                {RESTING_MESSAGE}
              </div>
            )}
            <div ref={transcriptEndRef} aria-hidden="true" />
          </div>

          {/* Composer */}
          <form
            onSubmit={handleSend}
            className="border-t border-[#0C1B33]/10 px-3 py-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="Ask about incentives…"
                className="flex-1 resize-none border border-[#0C1B33]/15 bg-white px-3 py-2 text-[13px] text-[#0C1B33] outline-none focus:border-[#2563EB]"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Send message"
                className="flex h-9 w-9 items-center justify-center bg-[#2563EB] text-white transition-opacity disabled:opacity-40"
              >
                <Send className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <p className="mt-1.5 font-mono-bureau text-[8px] uppercase tracking-[0.15em] text-[#0C1B33]/30">
              Preparation guidance only · verify with administrators
            </p>
          </form>
        </div>
      )}
    </>
  );
}

/** One message row: text (markdown-lite), tool status lines, nav buttons. */
function ConciergeMessage({
  message,
  onNavigate,
  onApproval,
}: {
  message: { id?: string; role: string; parts?: Array<Record<string, unknown>> };
  onNavigate: (route: string) => void;
  onApproval: (approvalId: string, toolName: string, approved: boolean) => void;
}) {
  const isUser = message.role === "user";
  const parts = message.parts ?? [];

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[85%] bg-[#0C1B33] px-3 py-2 text-[13px] leading-relaxed text-white"
            : "max-w-[92%] space-y-2"
        }
      >
        {parts.map((part, i) => {
          const type = String(part.type);

          if (type === "text") {
            const text = String(part.text ?? "");
            if (!text) return null;
            return isUser ? (
              <span key={i}>{text}</span>
            ) : (
              <MarkdownLite key={i} text={text} />
            );
          }

          if (type.startsWith("tool-")) {
            const toolName = type.slice("tool-".length);
            const state = String(part.state ?? "");

            // Approval card — action tool awaiting the user's decision.
            if (state === "approval-requested") {
              const approval = part.approval as { id?: string } | undefined;
              if (!approval?.id) return null;
              const approvalId = approval.id;
              return (
                <ApprovalCard
                  key={i}
                  toolName={toolName}
                  input={part.input}
                  onApprove={() => onApproval(approvalId, toolName, true)}
                  onDecline={() => onApproval(approvalId, toolName, false)}
                />
              );
            }

            // Declined → polite confirmation that nothing happened.
            if (state === "output-denied") {
              return (
                <div
                  key={i}
                  className="border border-[#0C1B33]/12 bg-[#FAF9F6] px-3 py-2 text-[12px] leading-relaxed text-[#0C1B33]/60"
                >
                  You declined that action — nothing was changed.
                </div>
              );
            }

            // A tool result carrying a nav / deep-link suggestion → button.
            if (state === "output-available") {
              const output = part.output as
                | { ok?: boolean; note?: string; suggestion?: NavSuggestion | null }
                | undefined;
              const s = output?.suggestion;
              if (s?.route) {
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onNavigate(s.route)}
                    className="flex w-full items-center justify-between gap-2 border border-[#2563EB]/40 bg-[#2563EB]/5 px-3 py-2 text-left transition-colors hover:bg-[#2563EB]/10"
                  >
                    <span className="text-[12px] font-medium text-[#0C1B33]">
                      {s.label}
                      {s.reason ? (
                        <span className="block font-normal text-[11px] text-[#0C1B33]/55">
                          {s.reason}
                        </span>
                      ) : null}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#2563EB]" />
                  </button>
                );
              }
              // Action tool success without a deep-link → small confirmation.
              if (ACTION_TOOL_NAMES.has(toolName) && output?.ok) {
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] leading-relaxed text-emerald-800"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    {output.note ?? "Done."}
                  </div>
                );
              }
              if (ACTION_TOOL_NAMES.has(toolName) && output?.ok === false) {
                return (
                  <div
                    key={i}
                    role="alert"
                    className="flex items-start gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-800"
                  >
                    <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {output.note ?? "That action could not be completed. Nothing was changed."}
                  </div>
                );
              }
              return null;
            }

            // Still running (input-streaming / input-available) → status line.
            if (state !== "output-error") {
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 text-[#0C1B33]/40"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="font-mono-bureau text-[9px] uppercase tracking-[0.15em]">
                    {TOOL_STATUS[toolName] ?? "Working…"}
                  </span>
                </div>
              );
            }
            return (
              <div
                key={i}
                role="alert"
                className="flex items-start gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-800"
              >
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {ACTION_TOOL_NAMES.has(toolName)
                  ? "That action could not be completed. Nothing was changed."
                  : "I couldn't complete that check. Please try again."}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

/**
 * Explicit approval card for an action tool. Shows what will change (the tool's
 * proposed input, as field → value rows) and Approve / Decline buttons. Nothing
 * runs on the server until Approve is clicked.
 */
function ApprovalCard({
  toolName,
  input,
  onApprove,
  onDecline,
}: {
  toolName: string;
  input: unknown;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const rows = toApprovalRows(input);
  return (
    <div className="border border-[#2563EB]/40 bg-[#2563EB]/[0.04] p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-[#2563EB]" strokeWidth={1.75} />
        <p className="font-mono-bureau text-[9px] uppercase tracking-[0.18em] text-[#0C1B33]/55">
          Approve this action
        </p>
      </div>
      <p className="mt-2 text-[13px] font-medium leading-snug text-[#0C1B33]">
        {ACTION_LABEL[toolName] ?? toolName}
      </p>
      {rows.length > 0 && (
        <dl className="mt-2 space-y-1 border-t border-[#0C1B33]/10 pt-2">
          {rows.map((r) => (
            <div key={r.key} className="flex gap-2 text-[11px] leading-relaxed">
              <dt className="shrink-0 font-mono-bureau uppercase tracking-[0.1em] text-[#0C1B33]/40">
                {r.key}
              </dt>
              <dd className="min-w-0 break-words text-[#0C1B33]/80">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-[#0C1B33]/45">
        Nothing changes until you approve. This prepares and organizes — it never
        certifies or submits anything for you.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          className="flex flex-1 items-center justify-center gap-1.5 bg-[#2563EB] px-3 py-2 text-white transition-opacity hover:opacity-90"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.15em]">
            Approve
          </span>
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="flex flex-1 items-center justify-center gap-1.5 border border-[#0C1B33]/20 px-3 py-2 text-[#0C1B33]/70 transition-colors hover:bg-[#0C1B33]/5"
        >
          <Ban className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="font-mono-bureau text-[10px] uppercase tracking-[0.15em]">
            Decline
          </span>
        </button>
      </div>
    </div>
  );
}
