"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileUp, Loader2, ScanLine, Trash2, Check } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import { SUGGESTION_DISCLAIMER } from "@/lib/document-flags";
import { acceptAttributeForKinds } from "@/lib/document-spec";
import {
  extractExtractionResult,
  extractPacketDocuments,
  type ExtractionResultView,
  type PacketDocumentView,
  type PreparationTask,
} from "./types";

interface DocumentAttachmentsProps {
  packetId: string;
  task: PreparationTask;
  documents: PacketDocumentView[];
  extractEnabled: boolean;
  profileEditHref: string | null;
  /** Called with the full, server-authoritative document list after any change. */
  onDocumentsChange: (documents: PacketDocumentView[]) => void;
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  uploaded: { label: "Uploaded", className: "border-[#0C1B33]/12 bg-[#FAF9F6] text-[#0C1B33]/60" },
  confirmed_current: {
    label: "Confirmed current",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  superseded: { label: "Replaced", className: "border-[#0C1B33]/12 bg-[#0C1B33]/[0.04] text-[#0C1B33]/45" },
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function DocumentAttachments({
  packetId,
  task,
  documents,
  extractEnabled,
  profileEditHref,
  onDocumentsChange,
}: DocumentAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | string>("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, ExtractionResultView>>({});

  const spec = task.documentSpec;
  const multi = spec?.multi ?? false;
  const acceptAttr = acceptAttributeForKinds(spec?.acceptedTypes ?? []);
  const active = documents.filter((doc) => doc.status !== "superseded");
  const uploadLabel = active.length === 0 ? "Attach file" : multi ? "Add file" : "Replace file";

  const uploadFile = async (file: File) => {
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("taskId", task.id);
      const response = await fetch(`/api/incentive-preparation/${packetId}/documents`, {
        method: "POST",
        body: form,
      });
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Could not upload this file.",
        );
      }
      onDocumentsChange(extractPacketDocuments(body));
      trackEvent("packet_document_uploaded", {
        source: "preparation_packet_detail",
        metadata: { taskId: task.id, contentType: file.type || "unknown" },
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload this file.");
    } finally {
      setBusy("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmCurrent = async (doc: PacketDocumentView) => {
    setBusy(doc.id);
    setError("");
    try {
      const response = await fetch(
        `/api/incentive-preparation/${packetId}/documents/${doc.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "confirmed_current" }),
        },
      );
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Could not update.");
      }
      onDocumentsChange(extractPacketDocuments(body));
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Could not update.");
    } finally {
      setBusy("");
    }
  };

  const deleteDocument = async (doc: PacketDocumentView) => {
    if (!window.confirm(`Delete "${doc.originalName}"? This permanently removes the file.`)) {
      return;
    }
    setBusy(doc.id);
    setError("");
    try {
      const response = await fetch(
        `/api/incentive-preparation/${packetId}/documents/${doc.id}`,
        { method: "DELETE" },
      );
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Could not delete.");
      }
      onDocumentsChange(extractPacketDocuments(body));
      trackEvent("packet_document_deleted", {
        source: "preparation_packet_detail",
        metadata: { taskId: task.id },
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete.");
    } finally {
      setBusy("");
    }
  };

  const runExtract = async (doc: PacketDocumentView) => {
    setBusy(`extract-${doc.id}`);
    setError("");
    try {
      const response = await fetch(
        `/api/incentive-preparation/${packetId}/documents/${doc.id}/extract`,
        { method: "POST" },
      );
      const body = await responseBody(response);
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Could not read this document.",
        );
      }
      const result = extractExtractionResult(body);
      setSuggestions((current) => ({ ...current, [doc.id]: result }));
      trackEvent("packet_document_extract_suggested", {
        source: "preparation_packet_detail",
        metadata: { taskId: task.id, suggestionCount: result.suggestions.length },
      });
    } catch (extractError) {
      setError(
        extractError instanceof Error ? extractError.message : "Could not read this document.",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-3 border-t border-[#0C1B33]/8 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#0C1B33]/45">
          Documents{spec ? ` · ${active.length} attached` : ""}
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy === "upload"}
          className="inline-flex min-h-9 items-center gap-2 border border-[#2563EB]/35 px-3 py-1.5 font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB] hover:bg-[#2563EB]/5 disabled:opacity-60"
        >
          {busy === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
          {uploadLabel}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptAttr}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {documents.length > 0 && (
        <ul className="mt-3 space-y-2">
          {documents.map((doc) => {
            const chip = STATUS_CHIP[doc.status] ?? STATUS_CHIP.uploaded;
            const result = suggestions[doc.id];
            return (
              <li key={doc.id} className="border border-[#0C1B33]/10 bg-white px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={`/api/incentive-preparation/${packetId}/documents/${doc.id}/download`}
                    className="inline-flex items-center gap-1.5 text-sm text-[#0C1B33] hover:text-[#2563EB]"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="break-all">{doc.originalName}</span>
                  </a>
                  <span
                    className={`border px-2 py-0.5 font-mono-bureau text-[8px] uppercase tracking-[0.11em] ${chip.className}`}
                  >
                    {chip.label}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-[#0C1B33]/45">
                  {formatBytes(doc.sizeBytes)}
                  {doc.retentionExpiresAt
                    ? ` · Stored until ${formatDate(doc.retentionExpiresAt)} unless you delete it sooner.`
                    : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {doc.status !== "superseded" && doc.status !== "confirmed_current" && (
                    <button
                      type="button"
                      onClick={() => confirmCurrent(doc)}
                      disabled={busy === doc.id}
                      className="inline-flex min-h-8 items-center gap-1.5 border border-emerald-300 px-2.5 py-1 font-mono-bureau text-[8px] uppercase tracking-[0.11em] text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                    >
                      {busy === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Confirm current
                    </button>
                  )}
                  {extractEnabled && doc.status !== "superseded" && (
                    <button
                      type="button"
                      onClick={() => runExtract(doc)}
                      disabled={busy === `extract-${doc.id}`}
                      className="inline-flex min-h-8 items-center gap-1.5 border border-[#0C1B33]/20 px-2.5 py-1 font-mono-bureau text-[8px] uppercase tracking-[0.11em] text-[#0C1B33]/70 hover:bg-[#0C1B33]/[0.04] disabled:opacity-60"
                    >
                      {busy === `extract-${doc.id}` ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ScanLine className="h-3 w-3" />
                      )}
                      Suggest field values
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteDocument(doc)}
                    disabled={busy === doc.id}
                    className="inline-flex min-h-8 items-center gap-1.5 border border-red-200 px-2.5 py-1 font-mono-bureau text-[8px] uppercase tracking-[0.11em] text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>

                {result && (
                  <div className="mt-2 border border-[#2563EB]/25 bg-[#2563EB]/[0.04] px-3 py-2.5">
                    <p className="font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB]">
                      {result.disclaimer || SUGGESTION_DISCLAIMER}
                    </p>
                    {result.suggestions.length > 0 ? (
                      <>
                        <dl className="mt-2 space-y-1.5">
                          {result.suggestions.map((suggestion) => (
                            <div
                              key={suggestion.field}
                              className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5"
                            >
                              <dt className="text-[#0C1B33]/50">{suggestion.label}:</dt>
                              <dd className="text-[#0C1B33]/80">{suggestion.value}</dd>
                            </div>
                          ))}
                        </dl>
                        {profileEditHref && (
                          <Link
                            href={profileEditHref}
                            className="mt-2 inline-block font-mono-bureau text-[9px] uppercase tracking-[0.12em] text-[#2563EB] hover:underline"
                          >
                            Review and apply in your Business File →
                          </Link>
                        )}
                      </>
                    ) : (
                      <p className="mt-1.5 text-xs leading-5 text-[#0C1B33]/55">
                        {result.supported
                          ? "No profile fields were found to suggest. Nothing was changed."
                          : "Suggestions are not available for this file type. Nothing was changed."}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
