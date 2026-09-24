# Corridor Intelligence: restoration and repeatable research

Prepared September 24, 2026. Product scope for review; dates and staffing are not commitments.

## Outcome

A corridor manager selects approved street boundaries and a reporting period, receives a dated evidence-backed brief and companion Google Sheet, reviews gaps, and approves any external release. Each number can be traced to preserved source rows and a reproducible calculation. Re-running an export does not create duplicate Google files.

The immediate need is Ellen's eight-corridor small-business discussion. The supplied correspondence proposes October 15, 2026, 2–3 p.m., with 45 minutes for the group; attendance, exact slot and time zone remain unconfirmed. No invitation or schedule is part of this work.

## Existing implementation and limits

- `scripts/compute-corridor.ts` computes ZIP snapshots for 60617, 60619 and 60649. It writes `corridor_metrics`, keyed by `(corridor_type, corridor_id, as_of)`. It is not an eight-street polygon engine.
- `lib/corridor-health.ts` provides reusable calculation patterns, but the old composite health score, license turnover and ownership-origin classification are not approved evaluation measures.
- `data/exports/corridor-metrics-citywide.json` is historical ZIP context. The research uses its July 3, 2026 snapshot consistently; a separate legacy export has different permit totals and a different spatial path. Do not mix the exports.
- Parcel classes beginning with `1` do not count vacant storefronts. License start dates do not prove openings. Permits and reported costs do not prove completion or dollars delivered. Null incentive coverage is unavailable, not zero.
- Original raw responses, selected parcel tax year and the historical run log were not retained with those aggregates. The saved-snapshot arithmetic can be reproduced; the original extraction cannot be fully replayed.
- BJT-80 is a completed data-platform epic, not proof this workflow exists. BJT-122 remains the decision on public versus partner-only ownership detail. This restoration exposes no owner identities or mailing addresses.

## P0: restore a useful research entry point

Acceptance criteria:

- `/corridors` renders Corridor Intelligence as a research preview, reachable from Neighborhood Analysis and the real report picker.
- The page preserves all eight requested endpoint pairs, includes Commercial Avenue's commercially zoned 2–3-block east/west extensions, and makes draft boundary status visible.
- Users can open each corridor's boundary questions, review six proposed measures, and navigate to existing map and permit analysis.
- Old `/corridors/:zip` links redirect temporarily to the restored landing page. The landing page does not redirect to itself. Previously cached permanent redirects may require a fresh visit/reload.
- Current street-level results remain explicitly unmeasured. No generation button implies a pipeline that does not exist. Old shared wizard links remain decodable; the picker does not launch that legacy generator.
- Rendered page, real report-picker, header and routing tests verify behavior. No database migration, live source refresh, deployment or schedule is required for P0.

## P1: approve geography and measurement definitions

Detailed source-to-geography mapping, verified polygon integration gaps and acceptance checks are in [Research and polygon coverage plan](research-and-polygon-coverage-plan.md). The companion workbook includes Research map, Polygon gaps, Corridor checks and Overlay inventory tabs.

Draft registry: `lib/corridor-research.ts`, version `2026-09-24-draft-1`.

| Corridor | Requested extent | Decision needed |
| --- | --- | --- |
| 79th Street | Greenwood–Paxton | Confirm direction labels, both sides and frontage |
| South Chicago Avenue | 72nd–87th | Follow the avenue; frontage and intersections |
| 87th Street | Ingleside–South Chicago | Direction labels and endpoint intersection |
| 95th Street | Woodlawn–Jeffery | Direction labels and frontage |
| Stony Island Avenue | 79th–95th | Both sides and cross-corridor overlap |
| Commercial Avenue | 83rd–95th plus 2–3 commercially zoned blocks E/W | Exact side-street and zoning footprint |
| Ewing Avenue | 101st–107th | Frontage and intersections |
| 106th Street | Buffalo–Avenue H | Direction labels and Ewing overlap |

Store stable corridor IDs, versioned GeoJSON polygons, CRS, boundary hash, inclusion rule, review status, reviewer and approval time. Review both street sides, mixed-use storefronts, intersecting parcels and Commercial extensions on a map. Draft geometry must not be presented as approved. An entity may occur in multiple individual profiles, but the combined total uses the union and stable entity IDs. Do not allocate ZIP statistics to street segments.

Acceptance: approved polygons and unit/cohort definitions; fixture tests for endpoints, spatial inclusion, mixed-use units, intersection overlap and union deduplication. Changing geography creates a new version and marks old/new comparisons as non-equivalent until recalculated on a common boundary.

## P2: capture immutable source evidence

Reuse existing City/County loaders where their contracts fit. Preserve immutable raw responses or permitted source extracts, query parameters, dataset identity and schema, explicit parcel tax year, observation window, retrieval time, row counts, source update date, code revision and hashes. Do not overwrite the last successful run on failure.

Proposed records (new storage design and migrations are future implementation):

- `corridor_definitions`: stable ID and versioned approved geometry.
- `corridor_runs`: immutable run ID, requested period, geography/metric-definition versions, state and actor.
- `corridor_source_snapshots`: run/source IDs, storage URI, query, tax year, source date, retrieval time, schema/hash and coverage diagnostics.
- `corridor_measurements`: run/corridor/metric IDs, status, numerator, denominator, value, unit, unknown count, coverage, source IDs and calculation version.
- `corridor_exports`: run ID plus export version, template version, native Google IDs, verification result and review state. Unique idempotency key per run/export version.

Use a run manifest shared by every output:

```json
{
  "run_id": "immutable-id",
  "status": "draft",
  "period": { "start": "YYYY-MM-DD", "end_exclusive": "YYYY-MM-DD" },
  "geography_version": "approved-version",
  "geography_sha256": "hash",
  "metric_definition_version": "version",
  "code_revision": "git-commit",
  "sources": [{ "source_id": "id", "query": {}, "tax_year": null,
    "retrieved_at": "RFC3339", "source_as_of": null, "row_count": 0,
    "sha256": "hash", "status": "unavailable", "storage_uri": null }],
  "claims": [{ "claim_id": "id", "metric_id": "id", "source_ids": [],
    "calculation_version": "version", "status": "unavailable" }],
  "exports": { "doc_id": null, "sheet_id": null, "verified_at": null }
}
```

Dates and row counts above are schema examples, not evidence. A required missing tax year blocks the dependent measure. Paginated extraction must reconcile counts and flag truncation; schema drift, missing coordinates, duplicates and freshness violations produce explicit diagnostics. Unknown, unavailable, stale and verified zero are distinct states. Retained raw records require access control and an agreed retention policy.

Acceptance: replay one run from retained inputs without calling the live provider; independent row-count/hash checks; tests for source outage, pagination failure, stale data and schema changes.

## P3: compute a modest scorecard and verify it

| Measure | Calculation/evidence | Cadence proposed |
| --- | --- | --- |
| Operating businesses and change | Distinct verified operating locations; verified openings and closures; relocations separate | Quarter-end |
| Storefront occupancy | Occupied / (occupied + vacant) resolved units; show unknown units and checked / inventory coverage | Baseline, quarterly changes |
| Businesses assisted | Unique businesses receiving substantive one-to-one help; service types and completed referrals separately | Quarterly |
| Capital accessed | Confirmed disbursed grants and loans; distinct recipients and transactions separately | Quarterly |
| Assisted-business retention | Verified operating / all fixed-cohort businesses due at 6/12 months; show closed, unknown, response coverage and resolved-case share | 6 and 12 months |
| Physical reinvestment | Commercial permits and reported costs; independently verified completed improvement projects separately | Quarterly |

Public records can seed research; storefront status, assistance, capital and retention need authorized Chamber/partner records or field verification. Deduplicate business locations, storefront units, transactions and projects using different stable IDs. Preserve source evidence and ambiguity instead of inventing closures or ownership origin. Proposed responsibility: data lead for extracts and spatial reconciliation; Chamber for inventory/services; capital partners for disbursements; evaluation lead for definitions and cohort review. People are not assigned by this scope.

Acceptance: hand-reconciled pilot corridor, independently checked numerators/denominators, non-additive overlaps resolved, missing/unknown coverage displayed, and no causal-impact or measured-jobs claims. A zero denominator yields unavailable with explanation.

## P4: generate coordinated Google artifacts

Generate the brief, the eight profiles when measurable, a comparison table, source/claim registers and a companion workbook from the same immutable run manifest. The workbook retains typed values, formulas, denominators, dates, boundary version, source IDs and limitations. The Doc retains citations and the workbook link. Include run ID, template version and export timestamp in both.

Use the authorized Google account and an explicit output folder with private defaults. Persist returned native IDs before retries. If one export succeeds and the other fails, retry only the missing artifact; update the existing draft where appropriate, and create a versioned replacement when a reviewed artifact must be preserved. Protect manual reviewer edits with revision checks rather than overwriting them. Read back both files and reconcile values, formulas, row counts, citations and run ID before declaring success. PDF/layout inspection is a separate check from numerical reconciliation.

Acceptance: one reviewed manual run produces a native Doc and Sheet with the same manifest, no orphaned placeholders, source links and matching figures. Retry/partial-success, expired Google authorization, revision conflict and permission tests pass. External sharing or delivery requires Billy's review and approval; generation never sends a message.

## P5: schedule only after the manual workflow works

After at least two successful reviewed manual runs, agree the refresh cadence, source freshness thresholds, operational owner and destination. Proposed cadence is a quarterly draft, with source availability checks appropriate to each provider. Scheduling is a later implementation decision, not an automation created by this restoration.

Run states: queued → capturing → calculating → validating → exporting → awaiting review → approved. Failed/partial/stale states retain diagnostics and the last successful artifact with its original date. Use a per-run lock, bounded retries/backoff, idempotent export keys, cancellation, runtime/cost budgets and a visible run history. Notify the operational owner only for a completed reviewable draft, material change, failure or required decision; keep unchanged checks quiet. Never auto-release to external recipients.

Acceptance: duplicate-trigger, crash/retry, partial-source, schema-change and access-loss tests; replayable audit trail; agreed review/release ownership; successful dry-run schedule. Live enablement is a separate release decision.

## Release sequence and non-goals

Ship P0 after code review, choose one pilot for P1–P3, complete coordinated manual exports in P4, then evaluate P5. Pilot corridor, boundary reviewer, partner access, chosen tax year, freshness thresholds and reporting period remain open decisions. The Google artifacts created for Ellen are a manual example, not proof the application exports them.

No citywide expansion, health ranking, inferred local ownership, person-level public dossiers, causal impact model, CRM replacement, automatic outreach, billing changes or legacy-data rewrite is included. No live database migration or production data refresh occurs in P0. Public aggregate presentation and protected partner evidence remain separate until BJT-122 is resolved.
