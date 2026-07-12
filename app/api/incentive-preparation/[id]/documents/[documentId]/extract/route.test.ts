import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, sqlMock, readBufferMock, extractMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
  readBufferMock: vi.fn(),
  extractMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));
vi.mock("@/lib/documents", () => ({ readDocumentBlobBuffer: readBufferMock }));
vi.mock("@/lib/document-extraction", () => ({ extractDocumentSuggestions: extractMock }));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "packet-1", documentId: "doc-1" }) };

const docRow = {
  id: "doc-1",
  blob_path: "business-file/user-1/packet-1/program-document-1/uuid.pdf",
  content_type: "application/pdf",
  original_name: "profile.pdf",
};

function req() {
  return new NextRequest(
    "http://localhost/api/incentive-preparation/packet-1/documents/doc-1/extract",
    { method: "POST" },
  );
}

function enableAll() {
  process.env.DOCUMENTS_ENABLED = "true";
  process.env.BLOB_READ_WRITE_TOKEN = "token";
  process.env.AI_GATEWAY_API_KEY = "key";
  process.env.DOCUMENTS_EXTRACT_ENABLED = "true";
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
  readBufferMock.mockReset();
  extractMock.mockReset();
  enableAll();
});

afterEach(() => {
  delete process.env.DOCUMENTS_ENABLED;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.DOCUMENTS_EXTRACT_ENABLED;
});

describe("POST extract", () => {
  it("503s when extraction is not enabled", async () => {
    delete process.env.DOCUMENTS_EXTRACT_ENABLED;
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const res = await POST(req(), params);
    expect(res.status).toBe(503);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("returns reviewed suggestions for an owned document", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([docRow]);
    readBufferMock.mockResolvedValue(Buffer.from("%PDF"));
    extractMock.mockResolvedValue({
      supported: true,
      model: "openai/gpt-4o-mini",
      disclaimer: "Suggested from your document — review before applying.",
      suggestions: [{ field: "legalName", label: "Legal business name", value: "South Shore Supply LLC" }],
    });

    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestions: unknown[]; disclaimer: string };
    expect(body.suggestions).toHaveLength(1);
    expect(body.disclaimer).toMatch(/review before applying/i);
    expect(extractMock).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "application/pdf", originalName: "profile.pdf" }),
    );
  });

  it("404s when the document is not owned", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([]);
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
    expect(readBufferMock).not.toHaveBeenCalled();
  });
});
