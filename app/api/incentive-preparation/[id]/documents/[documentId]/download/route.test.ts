import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, sqlMock, getMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: getMock, del: vi.fn() }));

import { GET } from "./route";

const params = { params: Promise.resolve({ id: "packet-1", documentId: "doc-1" }) };

function docRow(originalName: string) {
  return {
    id: "doc-1",
    blob_path: "business-file/user-1/packet-1/program-document-1/uuid.pdf",
    content_type: "application/pdf",
    original_name: originalName,
  };
}

function blobResult() {
  return {
    statusCode: 200,
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([37, 80, 68, 70]));
        controller.close();
      },
    }),
    blob: { contentType: "application/pdf" },
  };
}

function req() {
  return new NextRequest(
    "http://localhost/api/incentive-preparation/packet-1/documents/doc-1/download",
  );
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
  getMock.mockReset();
  process.env.DOCUMENTS_ENABLED = "true";
  process.env.BLOB_READ_WRITE_TOKEN = "token";
});

afterEach(() => {
  delete process.env.DOCUMENTS_ENABLED;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("GET download", () => {
  it("streams the private blob with download-forcing headers", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([docRow("w9.pdf")]);
    getMock.mockResolvedValue(blobResult());

    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith(
      "business-file/user-1/packet-1/program-document-1/uuid.pdf",
      { access: "private" },
    );
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain('filename="w9.pdf"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("survives non-ASCII filenames via an ASCII fallback plus RFC 5987 encoding", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([docRow('报告 "final".pdf')]);
    getMock.mockResolvedValue(blobResult());

    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    // The quoted fallback is printable ASCII only.
    const fallback = /filename="([^"]*)"/.exec(disposition)?.[1] ?? "";
    expect(fallback.length).toBeGreaterThan(0);
     
    expect(/^[\x20-\x7e]*$/.test(fallback)).toBe(true);
    // The original name survives percent-encoded for capable clients.
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent("报告"));
  });

  it("404s for a document outside the user's scope", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([]);
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("503s when the feature is disabled", async () => {
    delete process.env.DOCUMENTS_ENABLED;
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const res = await GET(req(), params);
    expect(res.status).toBe(503);
  });
});
