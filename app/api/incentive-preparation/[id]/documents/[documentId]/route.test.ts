import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCurrentUserIdMock, sqlMock, delMock } = vi.hoisted(() => ({
  getCurrentUserIdMock: vi.fn(),
  sqlMock: vi.fn(),
  delMock: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUserId: getCurrentUserIdMock }));
vi.mock("@/lib/db", () => ({ getSQL: () => sqlMock }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: delMock }));

import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "packet-1", documentId: "doc-1" }) };

const docRow = {
  id: "doc-1",
  task_id: "program-document-1",
  original_name: "w9.pdf",
  content_type: "application/pdf",
  size_bytes: 2048,
  blob_path: "business-file/user-1/packet-1/program-document-1/uuid.pdf",
  status: "uploaded",
  uploaded_at: "2026-07-12T00:00:00.000Z",
  retention_expires_at: "2028-01-12T00:00:00.000Z",
};

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/incentive-preparation/packet-1/documents/doc-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  getCurrentUserIdMock.mockReset();
  sqlMock.mockReset();
  delMock.mockReset();
  process.env.DOCUMENTS_ENABLED = "true";
  process.env.BLOB_READ_WRITE_TOKEN = "token";
});

afterEach(() => {
  delete process.env.DOCUMENTS_ENABLED;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("PATCH document (confirm current)", () => {
  it("confirms currency and returns the refreshed list", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const confirmed = { ...docRow, status: "confirmed_current" };
    sqlMock.mockResolvedValueOnce([confirmed]).mockResolvedValueOnce([confirmed]);

    const res = await PATCH(patchRequest({ status: "confirmed_current" }), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { status: string } };
    expect(body.document.status).toBe("confirmed_current");
    // The update excludes superseded rows so a replaced document can never be
    // resurrected into a second active file.
    const updateSql = String(sqlMock.mock.calls[0][0]);
    expect(updateSql).toContain("superseded");
  });

  it("rejects a status that is not user-settable", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const res = await PATCH(patchRequest({ status: "superseded" }), params);
    expect(res.status).toBe(400);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("503s when disabled", async () => {
    delete process.env.DOCUMENTS_ENABLED;
    getCurrentUserIdMock.mockResolvedValue("user-1");
    const res = await PATCH(patchRequest({ status: "confirmed_current" }), params);
    expect(res.status).toBe(503);
  });
});

describe("DELETE document", () => {
  it("hard-deletes the blob then the row", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock
      .mockResolvedValueOnce([docRow]) // getPacketDocument
      .mockResolvedValueOnce([]) // delete row
      .mockResolvedValueOnce([]); // list
    delMock.mockResolvedValue(undefined);

    const res = await DELETE(
      new NextRequest("http://localhost/api/incentive-preparation/packet-1/documents/doc-1", {
        method: "DELETE",
      }),
      params,
    );

    expect(res.status).toBe(200);
    expect(delMock).toHaveBeenCalledWith(docRow.blob_path);
    const body = (await res.json()) as { deleted: boolean; documents: unknown[] };
    expect(body.deleted).toBe(true);
  });

  it("404s when the document is not owned", async () => {
    getCurrentUserIdMock.mockResolvedValue("user-1");
    sqlMock.mockResolvedValueOnce([]);
    const res = await DELETE(
      new NextRequest("http://localhost/api/incentive-preparation/packet-1/documents/doc-1", {
        method: "DELETE",
      }),
      params,
    );
    expect(res.status).toBe(404);
    expect(delMock).not.toHaveBeenCalled();
  });
});
