/**
 * Assistive, flag-gated document extraction.
 *
 * When AI_GATEWAY_API_KEY is set and DOCUMENTS_EXTRACT_ENABLED === "true", an
 * uploaded document is run through the Vercel AI Gateway (OpenAI-compatible
 * Chat Completions) and returns SUGGESTED business-profile field values. The
 * suggestions are labeled and NEVER written directly — the user reviews and
 * applies them through the existing profile edit flow.
 *
 * Design choice (documented): PDFs are converted to text locally with `unpdf`
 * (a light, dependency-free pdf.js wrapper — no native binaries) and sent to a
 * text model; images (png/jpg/webp) are sent to the same model as a data URL
 * for vision. DOCX and any other type are intentionally out of scope for
 * extraction — extraction is best-effort assistance, and adding a DOCX parser
 * purely for a flag-gated suggestion path is not warranted. Those return
 * `supported: false` with no suggestions rather than erroring.
 */

import { extractText } from "unpdf";
import { SUGGESTION_DISCLAIMER } from "./document-flags";
import {
  contentTypeForKind,
  documentKindFromContentType,
  type DocumentKind,
} from "./document-spec";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
/** Cap the text sent to the model so a large PDF cannot blow the request. */
const MAX_TEXT_CHARS = 12000;

/** Profile fields extraction may suggest, with the labels shown to the user. */
export const SUGGESTION_FIELDS = [
  { field: "legalName", label: "Legal business name" },
  { field: "dbaName", label: "Doing-business-as name" },
  { field: "physicalAddress", label: "Physical address" },
  { field: "mailingAddress", label: "Mailing address" },
  { field: "contactName", label: "Authorized contact" },
  { field: "contactEmail", label: "Contact email" },
  { field: "contactPhone", label: "Contact phone" },
  { field: "entityType", label: "Entity type" },
  { field: "formationDate", label: "Formation date" },
  { field: "industry", label: "Industry" },
  { field: "naicsCode", label: "NAICS code" },
] as const;

const FIELD_LABELS = new Map(SUGGESTION_FIELDS.map((entry) => [entry.field, entry.label]));

export interface ExtractionSuggestion {
  field: string;
  label: string;
  value: string;
}

export interface ExtractionResult {
  supported: boolean;
  model: string;
  disclaimer: string;
  suggestions: ExtractionSuggestion[];
}

const PROMPT =
  "You are helping a small business owner assemble records for an incentive application. " +
  "From the supplied document, extract only the business-profile fields you can find. " +
  "Respond with a JSON object using these keys, and omit any key you cannot find with confidence: " +
  SUGGESTION_FIELDS.map((entry) => entry.field).join(", ") +
  ". Use YYYY-MM-DD for formationDate. Do not guess or invent values.";

type GatewayMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

async function callGateway(
  content: GatewayMessageContent,
  model: string,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not configured");

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Extraction model request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content ?? "";
  return parseModelJson(text);
}

function parseModelJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toSuggestions(raw: Record<string, unknown>): ExtractionSuggestion[] {
  const suggestions: ExtractionSuggestion[] = [];
  for (const [field, label] of FIELD_LABELS) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) {
      suggestions.push({ field, label, value: value.trim() });
    }
  }
  return suggestions;
}

async function suggestFromText(text: string, model: string): Promise<ExtractionSuggestion[]> {
  const clipped = text.slice(0, MAX_TEXT_CHARS);
  if (!clipped.trim()) return [];
  const raw = await callGateway(`${PROMPT}\n\nDocument text:\n${clipped}`, model);
  return toSuggestions(raw);
}

async function suggestFromImage(
  buffer: Buffer,
  kind: DocumentKind,
  model: string,
): Promise<ExtractionSuggestion[]> {
  const dataUrl = `data:${contentTypeForKind(kind)};base64,${buffer.toString("base64")}`;
  const raw = await callGateway(
    [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
    model,
  );
  return toSuggestions(raw);
}

/**
 * Run extraction against a document buffer. Never throws for an unsupported
 * type; throws only when the model request itself fails so the route can report
 * a real error.
 */
export async function extractDocumentSuggestions(params: {
  buffer: Buffer;
  contentType: string;
  originalName: string;
}): Promise<ExtractionResult> {
  const model = process.env.DOCUMENTS_EXTRACT_MODEL || DEFAULT_MODEL;
  const kind = documentKindFromContentType(params.contentType, params.originalName);
  const base = { model, disclaimer: SUGGESTION_DISCLAIMER };

  if (kind === "pdf") {
    const { text } = await extractText(new Uint8Array(params.buffer), { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    return { supported: true, ...base, suggestions: await suggestFromText(merged, model) };
  }

  if (kind === "png" || kind === "jpg" || kind === "webp") {
    return {
      supported: true,
      ...base,
      suggestions: await suggestFromImage(params.buffer, kind, model),
    };
  }

  // DOCX and anything else: assistive extraction is not offered.
  return { supported: false, ...base, suggestions: [] };
}
