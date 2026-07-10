# Refine Tier 1b — Design Note: Persona Chips & Two-Area Comparison

**Status:** proposed (not built). Companion to the Tier 1 refine PR.
**Source:** Report & Refine Workflow Audit, 2026-07-10 — findings **BM4** (persona/category chips, CONFIRMED) and **BM2** (comparison view, opportunity). These are the two remaining "true customization" items from Tier 1; the third (Corridor Intelligence promotion, RF7/WU7) shipped with the Tier 1 PR.

**Boundary reminder:** both features are discovery/navigation surfaces. All copy stays "may apply / estimate / verify with administrators" — nothing here certifies eligibility.

---

## 1. Persona chips on the instant snapshot (BM4)

### Problem
Every visitor sees the identical snapshot — the same layer list, program ordering, and copy — whether they are a resident, a first-time business owner, or a developer. Verified by the audit: no persona/audience field exists anywhere in `MapSnapshotPanel` props. Benchmarks (ArcGIS Business Analyst template gallery, NYC persona Q&A) branch by audience without a wizard.

### Proposed UX
- A single chip row directly under the snapshot cover (both ReportDisplay forks, via a shared component like `RefineValuePanel`):
  `VIEWING AS:  [ All ] [ Starting a business ] [ Growing / property owner ] [ Developer or investor ]`
- Mono-tracked uppercase chips, hairline borders, `#2563EB` selected state — same visual system as the report meta row.
- Selecting a chip **re-filters and re-orders existing report content client-side** (no new wizard route, no regeneration):
  - Program sections: rank programs tagged to the persona first; collapse (not hide) the rest under "Also at this address".
  - Action roadmap: keep only persona-relevant actions expanded.
  - Support network: advising-type orgs first for "starting", lenders/finance first for "developer".
- Persists per-session (sessionStorage) and round-trips in the share URL (`?persona=`), so a forwarded snapshot opens in the same lens.
- Copy stays descriptive ("programs most often used by developers"), never determinative.

### Data requirements
- A `personas: PersonaId[]` tag per program in the programs dataset (~70 programs; one-time editorial pass, review with SECCC staff). Default untagged = visible in "All" only.
- Optional per-persona ordering weight. No API or schema changes — the tag lives in the static program data the engine already loads.

### Instrumentation
- `persona_chip_selected` — metadata: `{ persona, reportType, matchedProgramsBefore, matchedProgramsAfter }`.
- Downstream: compare refine/save/share rates by persona (joins against `refine_value_preview_shown` context and the funnel events from the instrumentation PR).

### Effort: **M** (2–3 days)
Chip UI + filter logic ~1 day; program tagging pass ~1 day; tests + both-forks wiring ~0.5 day.

### Open questions
1. Chip vocabulary — the audit suggests "Resident / Starting a business / Developer or investor"; SECCC staff may want a "Lender / partner" lens instead of "Resident" (residents are a small share of report traffic).
2. Should a persona selection pre-fill the refine wizard's industry/project-type step? (Nice compounding win, small scope add.)
3. Does persona re-ordering apply to the PDF export too, or is print always the "All" view?

---

## 2. Two-area comparison from "watch an area" (BM2)

### Problem
Address-level compare exists ("Compare Another Address" on the report page), but there is no **area-level** comparison — a proven pattern in this product category (ZoomProspector "Compare Properties", ArcGIS "Compare with geographies") and the natural next step for the just-shipped "watch an area" feature. Corridor managers and lenders evaluate *areas* against each other, not single parcels.

### Proposed UX
- Entry points:
  1. Workspace → watched areas list: check two areas → "Compare areas" button.
  2. A watched-area detail view: "Compare with another watched area".
- Output: a two-column layout reusing the existing snapshot generator once per area centroid, plus a `ComparisonSummary`-style header table of area-level deltas: zone coverage count, active program count, vacancy signal, median income / home value context, TIF/SSA presence.
- Column cards reuse the existing `compact` ReportDisplay rendering (the compare plumbing the report page already has), each keeping its compact refine strip (shipped in Tier 1, RF4).
- Copy frame: "How these two areas differ on incentive coverage — a starting point for verification, not a ranking."

### Data requirements
- None new for v1: watched areas already store lat/lon + label; the snapshot generator and all zone/census fetches key on lat/lon. Area-level metrics reuse the corridor/`neighborhood-economics` endpoints where the area maps to a ZIP; otherwise the summary row degrades to the zone/program counts available at the centroid.
- v2 (optional): true polygon-level aggregation per community area — requires a server aggregation endpoint; defer.

### Instrumentation
- `compare_used` — metadata: `{ mode: "areas", source: "workspace" | "watch_detail" }` (the audit's named event; distinct from address-level compare).
- Optional: `compare_refine_clicked` folds into the existing refine events with `context: "compare_a" | "compare_b"` (already shipped in Tier 1).

### Effort: **M/L** (3–5 days)
Selection UI in Workspace ~1 day; dual-generation orchestration + summary deltas ~1.5 days; centroid-vs-ZIP mapping edge cases ~1 day; tests/smoke ~0.5–1 day.

### Open questions
1. Centroid semantics: a watched area's centroid may sit in a zone the area only partially covers — the summary must say "at the area's center point" or aggregate honestly. Which for v1?
2. Cap at 2 areas (audit's recommendation) or allow 3 on desktop?
3. Should an unauthenticated user get area-compare (watch-an-area requires sign-in today)? Recommend: keep it behind sign-in — it strengthens the workspace value ladder.

---

## Sequencing recommendation

Ship persona chips first: smaller, zero data-model risk, and it directly feeds the refine funnel this PR redesigned (a persona lens is the cheapest form of "customization before commitment"). Read `persona_chip_selected` + the funnel events for 2–3 weeks before deciding whether area-compare earns its build.
