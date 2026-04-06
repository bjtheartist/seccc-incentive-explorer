"use client";

import { useState } from "react";
import { Mail, X, Loader2, Check, AlertCircle } from "lucide-react";
import type { LookupResult, Program } from "@/lib/types";

interface EmailReportDialogProps {
  result: LookupResult;
  programs: Program[];
  open: boolean;
  onClose: () => void;
}

export function EmailReportDialog({
  result,
  programs,
  open,
  onClose,
}: EmailReportDialogProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");

  if (!open) return null;

  const handleSend = async () => {
    if (!email || !email.includes("@")) return;

    setStatus("sending");
    setErrorMsg("");

    try {
      const { generateReportBase64 } = await import("@/lib/pdf-report");
      const { base64, filename } = generateReportBase64(result, programs);

      const res = await fetch("/api/email-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          pdfBase64: base64,
          filename,
          businessName: result.business?.name,
          address: result.business
            ? `${result.business.address}, Chicago, IL ${result.business.zip}`
            : result.address,
          incentiveCount: result.incentiveCount,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send");
      }

      setStatus("sent");
      setTimeout(() => {
        onClose();
        setStatus("idle");
        setEmail("");
      }, 2000);
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong"
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && status === "idle") handleSend();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-[#0C1B33] border border-white/10 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#2563EB]/20 flex items-center justify-center">
              <Mail className="w-4 h-4 text-[#2563EB]" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-white">
                Email Report
              </h3>
              <p className="text-[10px] text-white/40 font-mono-bureau tracking-wide">
                PDF ATTACHED
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 space-y-4">
          {result.business && (
            <p className="text-xs text-white/40">
              Sending report for{" "}
              <span className="text-white/60">{result.business.name}</span>
            </p>
          )}

          <div>
            <label
              htmlFor="report-email"
              className="block font-mono-bureau text-[9px] tracking-[0.2em] uppercase text-white/30 mb-2"
            >
              Recipient Email
            </label>
            <input
              id="report-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="name@example.com"
              disabled={status === "sending" || status === "sent"}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#2563EB]/50 focus:ring-1 focus:ring-[#2563EB]/30 disabled:opacity-50 font-mono-bureau"
              autoFocus
            />
          </div>

          {status === "error" && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={
              !email || !email.includes("@") || status === "sending" || status === "sent"
            }
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-[#2563EB] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:hover:bg-[#2563EB] text-white transition-all font-mono-bureau text-[11px] tracking-wide"
          >
            {status === "sending" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : status === "sent" ? (
              <>
                <Check className="w-4 h-4" />
                Sent!
              </>
            ) : (
              <>
                <Mail className="w-4 h-4" />
                Send Report
              </>
            )}
          </button>

          <p className="text-[10px] text-white/20 text-center leading-relaxed">
            The full PDF report will be sent as an attachment.
          </p>
        </div>
      </div>
    </div>
  );
}
