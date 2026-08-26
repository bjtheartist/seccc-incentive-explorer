# Permit History Exhibit snapshots

Permit Exhibit snapshots turn a live, gated exhibit into a durable public-record artifact. The saved route renders only the JSONB document written at creation; it never queries current permits, parcel geometry, zoning, overlays, or archive state as a fallback.

## Product contract

- A valid `cie_shortlist_access` session is required to create, reopen, or print a snapshot.
- The URL uses a random 144-bit `publicId`; the page shows a separate human-readable `PX-…` display ID.
- Creation accepts only a PIN, supported radius, and UUID idempotency key. The server builds the exhibit and owns the saved time, IDs, source vintages, application revision, and hash.
- The complete `PermitExhibitResult` is preserved: S1–S4, coverage, query parameters, sources, and limits.
- A recursive canonical JSON encoding is hashed with SHA-256. Reads recalculate the hash and compare every duplicated integrity column before rendering.
- The database rejects every `UPDATE` or `DELETE` to a saved snapshot. There are no update or delete routes.
- Unknown, unavailable, corrupt, and future-schema snapshots never fall back to live evidence.
- The gate is professional access, not user identity. This release intentionally has no ownership claim, “My snapshots” library, rename, or delete controls.

## Routes

| Route | Role |
| --- | --- |
| `/permit-exhibit/[pin]` | Current live exhibit and `Save snapshot` action |
| `/permit-exhibit/snapshots/[publicId]` | Gated, stored-only saved exhibit |
| `/print/permit-exhibit/snapshots/[publicId]` | Gated, stored-only print/PDF surface with full provenance |

The existing `/print/permit-exhibit/[pin]` remains the explicitly current/live print surface.

## Storage and operations

Run the additive, idempotent migration before deploying code that exposes the save action:

```bash
npm run db:migrate:permit-exhibit-snapshots
```

The migration creates:

- `permit_exhibit_snapshots`, with format, uniqueness, JSON/column equality, and hash-shape constraints;
- a mutation-rejection trigger, making saved rows immutable;
- `permit_exhibit_snapshot_attempts`, containing only a SHA-256 client identifier and timestamp for the 20-per-hour creation limit.

Snapshot records contain no submitted name, title, email, raw IP address, or user ID. Gate signup information remains in its existing, separately governed store.

This release retains saved snapshots indefinitely because the product promises durable links and exposes no deletion workflow. A future retention or account-ownership change requires an explicit product and privacy decision, plus a new migration and user-visible policy.

## Integrity and versioning

`schemaVersion` controls the persisted document contract. `appRevision` records the deployed commit that created the artifact. Unsupported versions and checksum failures fail closed with an honest unavailable state.

The snapshot freezes evidence and provenance, not PDF bytes. A later presentation-only renderer change could alter typography or layout while the hashed evidence remains identical. If the product later promises byte-identical filed documents, generate one PDF at creation, store its bytes in durable object storage, and persist a second SHA-256 digest.

## Deliberate non-goals

- account-owned snapshot libraries;
- search/list APIs for saved artifacts;
- mutable notes, titles, or annotations;
- source-record refresh inside a saved URL;
- hidden replacement of missing or corrupt stored data;
- byte-identical PDF archival.
