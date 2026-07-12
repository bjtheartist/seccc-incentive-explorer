import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBlobPath, validateUpload } from "../documents";
import {
  MAX_DOCUMENT_BYTES,
  isDocumentExtractEnabled,
  isDocumentsEnabled,
} from "../document-flags";

describe("validateUpload", () => {
  it("accepts an allowlisted file within the size cap", () => {
    const result = validateUpload({ name: "bid.pdf", type: "application/pdf", size: 1024 });
    expect(result).toEqual({ ok: true, kind: "pdf", contentType: "application/pdf" });
  });

  it("rejects an unsupported type", () => {
    const result = validateUpload({ name: "notes.txt", type: "text/plain", size: 10 });
    expect(result.ok).toBe(false);
  });

  it("rejects a file over the size cap", () => {
    const result = validateUpload({
      name: "big.pdf",
      type: "application/pdf",
      size: MAX_DOCUMENT_BYTES + 1,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateUpload({ name: "x.pdf", type: "application/pdf", size: 0 }).ok).toBe(false);
  });
});

describe("buildBlobPath", () => {
  it("scopes the path by user id and never includes the original filename", () => {
    const path = buildBlobPath({
      userId: "user-1",
      packetId: "packet-1",
      taskId: "program-document-1",
      kind: "pdf",
    });
    expect(path.startsWith("business-file/user-1/packet-1/program-document-1/")).toBe(true);
    expect(path.endsWith(".pdf")).toBe(true);
    expect(path).not.toContain("bid.pdf");
  });

  it("randomizes the filename so two uploads never collide", () => {
    const base = { userId: "u", packetId: "p", taskId: "t", kind: "png" as const };
    expect(buildBlobPath(base)).not.toEqual(buildBlobPath(base));
  });
});

describe("document feature flags", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.DOCUMENTS_ENABLED;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.DOCUMENTS_EXTRACT_ENABLED;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("is off unless DOCUMENTS_ENABLED and a blob token are both set", () => {
    expect(isDocumentsEnabled()).toBe(false);
    process.env.DOCUMENTS_ENABLED = "true";
    expect(isDocumentsEnabled()).toBe(false);
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    expect(isDocumentsEnabled()).toBe(true);
  });

  it("gates extraction behind uploads plus a gateway key plus the extract flag", () => {
    process.env.DOCUMENTS_ENABLED = "true";
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    expect(isDocumentExtractEnabled()).toBe(false);
    process.env.AI_GATEWAY_API_KEY = "key";
    expect(isDocumentExtractEnabled()).toBe(false);
    process.env.DOCUMENTS_EXTRACT_ENABLED = "true";
    expect(isDocumentExtractEnabled()).toBe(true);

    // Extraction cannot run when uploads are off.
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(isDocumentExtractEnabled()).toBe(false);
  });
});
