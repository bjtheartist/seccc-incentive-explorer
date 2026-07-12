import { describe, expect, it } from "vitest";
import {
  acceptedKindsLabel,
  documentKindFromContentType,
  isDocumentKindTask,
  normalizeDocumentSpec,
  specAcceptsKind,
  type DocumentSpec,
} from "../document-spec";

describe("documentKindFromContentType", () => {
  it("maps allowlisted content types to kinds", () => {
    expect(documentKindFromContentType("application/pdf")).toBe("pdf");
    expect(documentKindFromContentType("image/jpeg")).toBe("jpg");
    expect(documentKindFromContentType("image/png")).toBe("png");
    expect(documentKindFromContentType("image/webp")).toBe("webp");
    expect(
      documentKindFromContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("docx");
  });

  it("falls back to the filename extension when the type is generic", () => {
    expect(documentKindFromContentType("application/octet-stream", "scan.PDF")).toBe("pdf");
    expect(documentKindFromContentType("", "photo.jpeg")).toBe("jpg");
  });

  it("returns null for anything outside the allowlist", () => {
    expect(documentKindFromContentType("text/plain", "notes.txt")).toBeNull();
    expect(documentKindFromContentType("application/zip", "bundle.zip")).toBeNull();
  });
});

describe("normalizeDocumentSpec", () => {
  it("keeps only allowlisted accepted types and defaults multi to false", () => {
    const spec = normalizeDocumentSpec({
      id: "bids",
      label: "Two contractor bids",
      acceptedTypes: ["pdf", "exe", "PNG"],
    });
    expect(spec).toEqual({
      id: "bids",
      label: "Two contractor bids",
      acceptedTypes: ["pdf", "png"],
      multi: false,
    });
  });

  it("treats an empty acceptedTypes array as 'any accepted type'", () => {
    const spec = normalizeDocumentSpec({ id: "w9", label: "W-9 form", acceptedTypes: [], multi: true });
    expect(spec?.acceptedTypes).toEqual([]);
    expect(spec?.multi).toBe(true);
  });

  it("rejects specs without an id or label", () => {
    expect(normalizeDocumentSpec({ label: "no id" })).toBeNull();
    expect(normalizeDocumentSpec({ id: "no-label" })).toBeNull();
    expect(normalizeDocumentSpec(null)).toBeNull();
  });
});

describe("specAcceptsKind", () => {
  const generic: DocumentSpec = { id: "g", label: "g", acceptedTypes: [], multi: false };
  const pdfOnly: DocumentSpec = { id: "p", label: "p", acceptedTypes: ["pdf"], multi: false };

  it("accepts any kind for a generic (empty) spec", () => {
    expect(specAcceptsKind(generic, "docx")).toBe(true);
    expect(specAcceptsKind(generic, "png")).toBe(true);
  });

  it("narrows to the listed kinds", () => {
    expect(specAcceptsKind(pdfOnly, "pdf")).toBe(true);
    expect(specAcceptsKind(pdfOnly, "png")).toBe(false);
  });

  it("labels a generic spec as accepting any type", () => {
    expect(acceptedKindsLabel(generic)).toMatch(/any/i);
    expect(acceptedKindsLabel(pdfOnly)).toBe("PDF");
  });
});

describe("isDocumentKindTask", () => {
  it("is true for a task with a documentSpec", () => {
    expect(
      isDocumentKindTask({
        status: "complete",
        documentSpec: { id: "x", label: "x", acceptedTypes: [], multi: false },
      }),
    ).toBe(true);
  });

  it("is true for a needs_document task with no spec", () => {
    expect(isDocumentKindTask({ status: "needs_document" })).toBe(true);
  });

  it("is false for other tasks", () => {
    expect(isDocumentKindTask({ status: "needs_owner_answer" })).toBe(false);
    expect(isDocumentKindTask({ status: "external_dependency", documentSpec: null })).toBe(false);
  });
});
