import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, sqlMock, putMock, getMock, delMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
  putMock: vi.fn(),
  getMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));
vi.mock("@vercel/blob", () => ({ put: putMock, get: getMock, del: delMock }));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "packet-1" }) };

const packetRow = {
  id: "packet-1",
  tasks_json: [
    {
      id: "program-document-1",
      title: "Collect program document: W-9 form",
      description: "",
      status: "needs_document",
      owner: "business",
      category: "goal",
      dependsOn: [],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 2,
      documentSpec: { id: "w9", label: "W-9 form", acceptedTypes: ["pdf"], multi: false },
    },
    {
      id: "foundation-business-identity",
      title: "Confirm the business identity",
      description: "",
      status: "needs_owner_answer",
      owner: "business",
      category: "foundation",
      dependsOn: [],
      estimatedMinWeeks: 0.5,
      estimatedMaxWeeks: 1,
    },
  ],
  program_id: "sbif",
  program_name: "SBIF",
  goal_type: "improve-storefront",
};

const insertedRow = {
  id: "doc-1",
  task_id: "program-document-1",
  original_name: "w9.pdf",
  content_type: "application/pdf",
  size_bytes: 2048,
  status: "uploaded",
  uploaded_at: "2026-07-12T00:00:00.000Z",
  retention_expires_at: "2028-01-12T00:00:00.000Z",
};

function uploadRequest(fields: { file?: File; taskId?: string }) {
  const form = new FormData();
  if (fields.file) form.append("file", fields.file);
  if (fields.taskId !== undefined) form.append("taskId", fields.taskId);
  return new NextRequest("http://localhost/api/incentive-preparation/packet-1/documents", {
    method: "POST",
    body: form,
  });
}

function pdfFile(size = 2048, name = "w9.pdf", type = "application/pdf") {
  return new File([new Uint8Array(size)], name, { type });
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
  putMock.mockReset();
  delMock.mockReset();
  process.env.DOCUMENTS_ENABLED = "true";
  process.env.BLOB_READ_WRITE_TOKEN = "token";
});

afterEach(() => {
  delete process.env.DOCUMENTS_ENABLED;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("POST documents (upload)", () => {
  it("503s when the feature is disabled", async () => {
    delete process.env.DOCUMENTS_ENABLED;
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const res = await POST(uploadRequest({ file: pdfFile(), taskId: "program-document-1" }), params);
    expect(res.status).toBe(503);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("401s without authentication", async () => {
    getCurrentUserIdMock.mockResolvedValue(null);
    const res = await POST(uploadRequest({ file: pdfFile(), taskId: "program-document-1" }), params);
    expect(res.status).toBe(401);
  });

  it("404s for a packet outside the user's scope", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([]);
    const res = await POST(uploadRequest({ file: pdfFile(), taskId: "program-document-1" }), params);
    expect(res.status).toBe(404);
  });

  it("uploads to private blob storage and inserts a scoped row", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock
      .mockResolvedValueOnce([packetRow]) // loadOwnedPacket
      .mockResolvedValueOnce([insertedRow]) // insert
      .mockResolvedValueOnce([]) // supersede other single-file docs
      .mockResolvedValueOnce([insertedRow]); // list
    putMock.mockResolvedValue({
      pathname: "business-file/user-1/packet-1/program-document-1/uuid.pdf",
      url: "https://store.private.blob.vercel-storage.com/x",
    });

    const res = await POST(uploadRequest({ file: pdfFile(), taskId: "program-document-1" }), params);

    expect(res.status).toBe(201);
    expect(putMock).toHaveBeenCalledTimes(1);
    const [path, , options] = putMock.mock.calls[0];
    expect(String(path)).toContain("business-file/user-1/packet-1/program-document-1/");
    expect(options).toMatchObject({ access: "private", addRandomSuffix: false });

    const body = (await res.json()) as { document: { id: string }; documents: unknown[] };
    expect(body.document.id).toBe("doc-1");
    expect(body.documents).toHaveLength(1);
  });

  it("rejects a type outside the allowlist", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([packetRow]);
    const res = await POST(
      uploadRequest({ file: pdfFile(10, "notes.txt", "text/plain"), taskId: "program-document-1" }),
      params,
    );
    expect(res.status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("rejects a type the spec does not accept", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([packetRow]);
    const res = await POST(
      uploadRequest({ file: pdfFile(10, "scan.png", "image/png"), taskId: "program-document-1" }),
      params,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/PDF/);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("rejects a task that does not accept documents", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([packetRow]);
    const res = await POST(
      uploadRequest({ file: pdfFile(), taskId: "foundation-business-identity" }),
      params,
    );
    expect(res.status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("GET documents (list)", () => {
  it("503s when disabled", async () => {
    delete process.env.DOCUMENTS_ENABLED;
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const res = await GET(
      new NextRequest("http://localhost/api/incentive-preparation/packet-1/documents"),
      params,
    );
    expect(res.status).toBe(503);
  });

  it("returns the owned packet's documents", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([packetRow]).mockResolvedValueOnce([insertedRow]);
    const res = await GET(
      new NextRequest("http://localhost/api/incentive-preparation/packet-1/documents"),
      params,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documents: Array<{ id: string; taskId: string }> };
    expect(body.documents).toEqual([
      expect.objectContaining({ id: "doc-1", taskId: "program-document-1", status: "uploaded" }),
    ]);
  });
});
