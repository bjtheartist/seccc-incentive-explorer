import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { extractTextMock } = vi.hoisted(() => ({ extractTextMock: vi.fn() }));
vi.mock("unpdf", () => ({ extractText: extractTextMock }));

import { extractDocumentSuggestions } from "../document-extraction";

function gatewayResponse(fields: Record<string, string>) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(fields) } }],
    }),
  } as Response;
}

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

beforeEach(() => {
  extractTextMock.mockReset();
  process.env.AI_GATEWAY_API_KEY = "test-key";
  delete process.env.DOCUMENTS_EXTRACT_MODEL;
});

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe("extractDocumentSuggestions", () => {
  it("extracts a PDF to text and returns reviewed suggestions", async () => {
    extractTextMock.mockResolvedValue({ totalPages: 1, text: "South Shore Supply LLC, Retail" });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(gatewayResponse({ legalName: "South Shore Supply LLC", industry: "Retail" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await extractDocumentSuggestions({
      buffer: Buffer.from("%PDF-1.4"),
      contentType: "application/pdf",
      originalName: "profile.pdf",
    });

    expect(extractTextMock).toHaveBeenCalledTimes(1);
    expect(result.supported).toBe(true);
    expect(result.disclaimer).toMatch(/review before applying/i);
    expect(result.suggestions).toEqual([
      { field: "legalName", label: "Legal business name", value: "South Shore Supply LLC" },
      { field: "industry", label: "Industry", value: "Retail" },
    ]);
    // A text model call, not vision.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(typeof body.messages[0].content).toBe("string");
  });

  it("sends an image as a vision message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(gatewayResponse({ contactEmail: "owner@example.com" }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await extractDocumentSuggestions({
      buffer: Buffer.from([0x89, 0x50]),
      contentType: "image/png",
      originalName: "card.png",
    });

    expect(extractTextMock).not.toHaveBeenCalled();
    expect(result.suggestions).toEqual([
      { field: "contactEmail", label: "Contact email", value: "owner@example.com" },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("reports docx as unsupported without calling the model", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await extractDocumentSuggestions({
      buffer: Buffer.from("PK"),
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      originalName: "form.docx",
    });

    expect(result.supported).toBe(false);
    expect(result.suggestions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
