# Eligibility-claims overhaul — acceptance doc

Binding sources: `scratchpad/battle-test/build-spec.md` (build spec), `AUDIT.md`
(findings F1–F16), `CONSULT.md` (consult ruling). This doc is the PR's
acceptance contract in place of a Linear issue (per the consult ruling,
"Linear/sequence BLOCKING" item 15). It grows across PR1 and PR2.

Two PRs, one worktree (`/Users/billyndizeye/seccc-wt/eligibility-build`):
- PR1 `feat/eligibility-claims-foundation` — contracts + data + producers. No
  consumer changes.
- PR2 `feat/eligibility-claims-cutover` (off PR1) — consumers, copy sweep,
  guards, concierge, survey, legacy deletion.

## PR1 — section 1.1: catalog schema extension

### What changed

Added five fields to every one of the 71 records in `public/data/programs.json`
(the internal catalog; relocated to `data/programs-internal.json` in section
1.2 — see below):

- `intakeStatus: open | rolling | closed | lapsed | pending | unknown`
- `statusAsOf: string` (ISO date) — set to each record's existing
  `lastVerifiedAt` for every record (the build spec's documented default:
  "use existing lastVerifiedAt where no better info").
- `benefitTermsStatus: current | historical | conditional | unknown`
- `locationRelation: required | preference | proxy | contextual | none`
- `nextWindow: { expected: string | null, note: string | null }`

New types: `IntakeStatus`, `BenefitTermsStatus`, `LocationRelation`,
`ProgramNextWindow` in `lib/types.ts` (all optional on `Program`, since
DB-backed rows in `app/api/programs/route.ts` do not populate them — see
"Decisions" below). New Zod schemas in `lib/schemas.ts`, also optional there
for the same reason. Catalog **completeness** (every one of the 71 records
has all five fields, with valid values) is enforced by a dedicated test —
`lib/__tests__/program-eligibility-fields.test.ts` — not by the Zod schema
being required, and PRESERVED_FIELDS in `lib/__tests__/program-schema.test.ts`
was extended to cover the five new fields so they round-trip losslessly
through `ProgramSchema.parse`.

Binding invariant asserted by test: **no record with `status` `lapsed` /
`sunset` / `pending` has `benefitTermsStatus: current`** or
`intakeStatus: open`. A mutation test proves the invariant check is not
vacuous (flipping `catalystGrant`'s `benefitTermsStatus` to `current` is
caught).

### Derivation policy (documented rules, applied consistently)

1. **`statusAsOf`** = the record's own `lastVerifiedAt` for all 71 records,
   per the build spec's explicit default. Where a record's `deadlines[]`
   entries are dated relative to `statusAsOf` (not "today" at authoring
   time), `intakeStatus` is derived relative to `statusAsOf` — e.g. a
   deadline dated after `statusAsOf` means the window was open as of the
   last verification. This keeps every record internally consistent even
   though a static catalog is inherently a point-in-time snapshot.
2. **`intakeStatus` for status `lapsed`** → `intakeStatus: lapsed`
   uniformly. All four lapsed-status records (`highUnemployment`,
   `catalystGrant`, `cannabisR3`, `climateInfrastructureFund`) describe a
   closed round/authority with no announced next round.
3. **`intakeStatus` for status `sunset`** (`sec179d`, the only one) →
   `lapsed` (closest enum value to "no longer generally available"; the
   IRS termination date has already passed for new construction).
4. **`intakeStatus` for status `pending`** (`edaBuildToScale`, the only
   one) → `pending`, per the explicit spec anchor, even though the record's
   own prose ("no upcoming NOFO... no expected date") reads closer to
   "lapsed." The spec anchor is authoritative and is followed exactly.
5. **`intakeStatus` for status `verify`** (`dataCenter`,
   `microMarketRecovery`, `cookCannabisGrant`) → derived from each
   record's own prose, not the `verify` status label itself:
   - `dataCenter` has an explicit `suspensionNote` → `closed`.
   - `microMarketRecovery` → `closed`, per the spec anchor and the record's
     own "NHS Chicago's purchase-assistance intake is currently closed."
   - `cookCannabisGrant` has no `suspensionNote`/`sunsetWarning` field set,
     but its `summary` prose states "no current or upcoming round is
     announced" — derived as `lapsed` from that prose, per the binding rule
     to derive from prose rather than defaulting because the structured
     `status` field alone didn't say "lapsed."
6. **`intakeStatus` for status `changed`** (`federalOZ`, `nmtcEligible`,
   `hubzone`, `iraCleanElectricity`) — each read individually; no
   uniform rule, since "changed" only means the record's terms/geography
   changed, not that intake is closed. `iraCleanElectricity` is the one
   `unknown` case in the whole catalog: its record describes both a closed
   sub-track (wind/solar construction-start deadline and the Low-Income
   Communities Bonus Credit window, both already past `statusAsOf`) and an
   unaffected, ongoing sub-track (non-wind/solar technologies). Rather than
   force one state onto a genuinely mixed record, `intakeStatus: unknown`
   was used — the safer choice under the binding derivation rule ("never
   default to open/current" — and forcing a false single certainty in
   either direction would be worse than `unknown`).
7. **`locationRelation` rule:**
   - `required` — the catalog's `zoneKey` maps a real boundary AND being
     inside it is the program's actual formal eligibility gate (e.g. `tif`,
     `nof`, `ssa`, `hubzone`, `energyCommunityBonus`).
   - `preference` — location is scored/weighted favorably but not
     mandatory. Used only for `cdgMedium`, whose own summary states
     "South/Southwest/West Side location is a scoring preference factor."
   - `proxy` — the app's mapped boundary is a known approximation, not the
     program's real criterion. Used for `edge`, `rev`, `micro`,
     `dataCenter` (all `zoneKey: stateIncentiveZones`, which
     `lib/constants.ts`'s `ZONE_META` itself documents as "Proxy boundary —
     REV / EDGE / MICRO / Data Center programs are project-by-project, not
     zone-based") and `microMarketRecovery` (whose own
     `boundaryDisclaimer` says the mapped boundary is stale — 13 legacy
     areas vs. 11 current CNRP target areas).
   - `contextual` — the program has a genuine geographic dimension (a
     specific site, a sub-region focus, employee residency, an
     inverse/excluded-area rule) that this catalog does not screen via a
     mapped boundary. Examples: `quantumEZ` (tied to the former South
     Works site, no `zoneKey`), `hib` (explicitly for projects *outside*
     Enterprise Zone boundaries), `class8` (restricted to five named
     south-suburban townships), `cookBrownfield` (suburban Cook County
     only, excludes the City of Chicago), `greenwoodArcher` /
     `alliesCommunityBusiness` (South/West Side-focused CDFIs),
     `workforceSolutions` (TIF-district location affects application
     timing, not core eligibility), `bmec` (inherits its location relation
     from whichever underlying zone program certified the project),
     `highUnemployment` (WOTC's Empowerment-Zone-residency category is one
     of several non-geographic target groups), `r3Grants` (statewide
     disinvested-community focus, no Chicago-specific boundary).
   - `none` — location plays no eligibility role beyond being within the
     product's general Cook County / Chicago / Illinois service area.
     Applied to `zoneKey`-empty records with no other geographic nuance
     (most County property-tax classes, most federal tax credits, SBA
     loan programs, utility rebates).
8. **`nextWindow`** — `expected` holds an ISO date when one specific date is
   known and relevant (a window close date, a statutory sunset, a
   recertification-window open date); otherwise `null` with the relevant
   detail in `note`. Free text never goes in `expected`.

### Full per-record table (71 records)

<!-- prettier-ignore -->
| id | status | intakeStatus | benefitTermsStatus | locationRelation | nextWindow.expected | derivation note |
|---|---|---|---|---|---|---|
| tif | active | rolling | current | required | — | Rolling TIF RDA program; no discrete application round. |
| federalOZ | changed | rolling | current | required | 2027-01-01 | Ongoing investment vehicle transitioning OZ 1.0→2.0; no application round, terms currently valid. |
| illinoisOZ | active | rolling | current | required | 2027-01-01 | Piggybacks federal OZ tract; same 2.0 timeline as federalOZ. |
| enterprise | active | rolling | current | required | 2028-01-01 | Ongoing zone-based exemption program; zones themselves expire 2030. |
| sbif | current | open | current | required | 2026-08-30 | Program describes itself as open on a monthly rollout schedule; August window is the currently listed open window. |
| edge | active | rolling | current | proxy | — | Negotiated withholding-credit program, not zone-gated in practice; mapped boundary is a high-unemployment-tract proxy per ZONE_META. |
| rev | active | rolling | current | proxy | — | Negotiated project-by-project credit across 4 tiers; not zone-gated. Proxy boundary per ZONE_META. |
| micro | active | rolling | current | proxy | — | Statute-based credit/training program; not zone-gated. Proxy boundary per ZONE_META. |
| dataCenter | verify | closed | conditional | proxy | — | Explicit suspensionNote; terms apply conditionally on resumption of intake. Proxy boundary per ZONE_META and the record's own boundaryDisclaimer. |
| ssa | active | rolling | current | required | — | Structural taxing-district mechanism, not an application program; benefit follows district membership. |
| highUnemployment | lapsed | lapsed | historical | contextual | — | Spec anchor: lapsed/historical. Zone tests employee residency in one of several non-geographic target-group categories, so location is contextual rather than a strict business-address requirement. |
| class7a | active | rolling | current | none | — | Cook County property-tax classification via Submittable portal; no fixed round, no mapped boundary in this catalog. |
| catalystGrant | lapsed | lapsed | historical | none | — | Spec anchor: lapsed/historical, window closed 2025-11-14, no round anticipated 2026-27. |
| cpace | active | rolling | current | none | — | Private-capital financing mechanism, ongoing, not zone-gated. |
| smallBizSource | active | rolling | current | none | — | Free advising, no eligibility gate beyond being in Cook County (the product's whole service area). |
| landBank | active | rolling | current | none | — | CCLBA inventory-driven acquisition program; Reclaiming Chicago Initiative emphasizes South Side lots but the broader commercial/industrial inventory is not boundary-gated in this catalog. |
| nof | active | rolling | current | required | — | Recurring city program; no deadline listed in this record. |
| nmtcEligible | changed | pending | current | required | — | Program made permanent by OBBBA (current terms), but this catalog's own text states the CY2026 round is not yet open → pending. |
| qct | active | rolling | current | required | — | HUD designation boosts LIHTC financing structuring; not itself an application program. |
| landmarkDistricts | active | rolling | current | required | — | Ongoing designation system via the Commission on Chicago Landmarks. |
| nrhpDistricts | active | rolling | current | required | — | Ongoing federal historic tax credit for NRHP-listed properties. |
| microMarketRecovery | verify | closed | conditional | proxy | — | Spec anchor: closed, $15,000 homeownership. Boundary layer is stale (13 legacy MMRP areas vs. 11 current CNRP target areas) → proxy. |
| industrialCorridors | active | rolling | current | required | — | Zoning-protection designation, structural not application-based. |
| ccsa | active | open | current | required | 2026-08-21 | Deadline (2026-08-21) is after last verification (2026-08-09) → window open as of verification. |
| hubzone | changed | rolling | conditional | required | — | Ongoing SBA certification, but redesignation-area terms are conditional on the 2026-07-01 grace-period expiry. |
| energyCommunityBonus | active | rolling | current | required | — | Ongoing IRA bonus credit tied to IRA energy-community boundary. |
| iraCleanElectricity | changed | unknown | conditional | none | — | Mixed signal: some sub-tracks closed (wind/solar construction start, LIC bonus window), the base credit for non-wind/solar remains ongoing. Marked unknown rather than guessing a single state, per the binding derivation rule. |
| electivePay | active | rolling | current | none | — | Ongoing IRA elective-pay/transferability mechanism, not zone-based. |
| sec179d | sunset | lapsed | historical | none | — | Statutory sunset already past for new construction; treated as lapsed/historical rather than an ongoing open credit. |
| hudSection108 | active | rolling | current | none | — | Ongoing federally-guaranteed loan program via CDBG entitlement cities. |
| cdfiBond | active | rolling | current | none | — | Ongoing Treasury-guaranteed bond program via Qualified Issuer CDFIs. |
| sba7a504 | active | rolling | current | none | 2026-09-30 | Ongoing SBA loan programs; fee waiver is a time-limited promotion, not the core program's availability. |
| sbaMicroloan | active | rolling | current | none | — | Ongoing SBA-funded nonprofit intermediary lending. |
| sbaDisasterEidl | current | open | conditional | none | 2027-01-25 | Mixed availability: physical-damage track closed, economic-injury track open → terms apply conditionally on track. |
| chips48d | active | rolling | current | none | — | Ongoing federal ITC for semiconductor manufacturing; not zone-based (spec anchor: 35%). |
| ssbciAdvantageIL | active | rolling | current | none | — | Ongoing DCEO loan participation/guarantee + INVENT VCP, statewide. |
| edaBuildToScale | pending | pending | historical | none | — | Spec anchor: pending/historical, no announced NOFO. |
| bmec | active | rolling | current | contextual | — | IDOR certificate contingent on prior certification under another zone/program (Enterprise Zone, RERZ, HIB, REV, MICRO, AIM, Quantum EZ) → inherits that program's location relation. |
| aim | active | rolling | current | none | — | Statewide capital tax credit by investment size/industry, not geography (effective tax years ≥ 2026-01-01, P.A. 104-0006). |
| quantumEZ | active | rolling | current | contextual | — | Tied to a specific site (Illinois Quantum & Microelectronics Park / former South Works), but no mapped boundary exists in this catalog. |
| hib | active | rolling | current | contextual | — | Explicitly for projects OUTSIDE Enterprise Zone boundaries — a real but inverse/unmapped location criterion. |
| innovationVoucher | active | rolling | current | none | — | Summary explicitly calls this a "Rolling DCEO grant." |
| economicEmpowermentCenters | active | rolling | current | none | — | Explicit expirationNote: "Round 2 applications are accepted on a rolling basis until funding is exhausted." |
| filmCredit | active | rolling | current | none | 2038-12-31 | Ongoing transferable credit, statutorily extended. |
| liveTheaterCredit | active | rolling | current | none | — | Ongoing transferable credit; rules amended 2025-12-04. |
| cannabisR3 | lapsed | lapsed | historical | none | — | Explicit status lapsed; matches catalystGrant pattern (closed round, no next round announced). |
| r3Grants | active | unknown | current | contextual | — | No round-specific info in this record; funding mechanism is ongoing/current but current intake status is not stated → unknown rather than guessing open. |
| class6b | active | rolling | current | none | — | Ongoing Cook County property-tax classification, renewable in 10-year increments. |
| class6bSer | active | rolling | current | none | — | Non-renewable 6b variant; requires municipal + County Board resolutions but no scheduled round. |
| class7b | active | rolling | current | none | — | Ongoing classification for commercial projects >$2M in areas needing commercial development. |
| class7c | active | rolling | current | none | — | Ongoing 5-year reduced-assessment classification. |
| class8 | active | rolling | current | contextual | — | Restricted to five named south-suburban townships (Bloom, Bremen, Calumet, Rich, Thornton) — a real geographic restriction not mapped by a zoneKey in this catalog. |
| class8aMicro | active | rolling | current | none | — | Class 8 variant for semiconductor/microchip investment; gated by investment type, not a mapped boundary. |
| classC | active | rolling | current | none | — | Triggered by property-specific IEPA No Further Remediation status, not geography. |
| classL | active | rolling | current | required | — | Cook County tax benefit triggered by City of Chicago landmark designation; shares zoneKey with landmarkDistricts. |
| ahsap | active | open | current | none | 2026-09-05 | Deadline (2026-09-05) is after last verification (2026-08-09) → window open as of verification. |
| cookCannabisGrant | verify | lapsed | historical | none | — | Prose states "no current or upcoming round is announced" despite catalog status of "verify" → derived as lapsed from prose per the binding rule. |
| investInCook | active | closed | current | none | — | Most recent round explicitly closed with no next-round date; annual program so "closed" (between windows) rather than "lapsed." |
| cookBrownfield | active | open | current | contextual | 2026-12-31 | Currently available but ARPA funding window ends this calendar year; suburban-only restriction is a genuine but unmapped location criterion. |
| cdgSmall | current | open | current | none | 2026-08-14 | Explicit "Citywide — no corridor or zone gate" in the record's own summary. |
| cdgMedium | current | open | current | preference | 2026-08-14 | Explicit "South/Southwest/West Side location is a scoring preference factor" in the record's own summary — matches the preference enum value directly. |
| cdgLarge | current | rolling | current | none | — | Explicit "Rolling application — no deadline" in the record's own summary. |
| workforceSolutions | current | open | current | contextual | — | TIF-district location affects application timing/process (year-round vs. quarterly window) but not core eligibility → contextual, not required. |
| climateInfrastructureFund | lapsed | lapsed | historical | none | — | Both halves of this combined record (CIF and ETOD) are explicitly closed with no successor announced. |
| comedEvRebate | active | open | current | none | 2026-12-31 | Deadline (2026-12-31) is after last verification (2026-08-09) → open, with a firm term cap. |
| comedSmallBizEfficiency | current | rolling | current | none | — | Ongoing ComEd efficiency program, no fixed round mentioned. |
| comedDgSolar | current | rolling | current | none | — | Ongoing upfront rebate program, no fixed round mentioned. |
| peoplesGasEfficiency | current | open | current | none | 2026-12-31 | Deadline (2026-12-31) is after last verification (2026-07-02) → open. |
| kivaChicago | current | rolling | current | none | — | Continuous crowdfunded lending platform, no application round. |
| greenwoodArcher | current | rolling | current | contextual | — | "South and West Side-focused" is a real targeting focus, not a formally mapped/gated boundary in this catalog. |
| alliesCommunityBusiness | current | rolling | current | contextual | — | "West Side-based" nonprofit CDFI targeting focus, not a formally mapped/gated boundary in this catalog. |

## PR1 — section 1.2: catalog relocation + public projection

### What changed

- **Relocated** the internal catalog: `git mv public/data/programs.json
  data/programs-internal.json`, then recreated `public/data/programs.json`
  with byte-identical content. `data/programs-internal.json` is now the
  source of truth; `public/data/programs.json` is a frozen duplicate kept
  only because current consumers still fetch it — deleted in PR2 (spec:
  "PR1 keeps public/data/programs.json in place ... deletion happens in PR2
  cutover"). A test
  (`lib/__tests__/program-public.test.ts` → "data/programs-internal.json vs
  public/data/programs.json") asserts the two files stay byte-identical for
  the rest of PR1, so nobody edits one copy and forgets the other.
- **`next.config.ts`**: added `outputFileTracingIncludes["/**"] =
  ["./data/programs-internal.json"]` — no PR1 route reads the file at
  request time yet (PR2 wires the actual consumer routes), so `"/**"` was
  used rather than guessing PR2's route list, mirroring the shortlist-
  universe precedent's own comment ("Declared now, even though PR2 wires
  the actual consumer route"). Guarded by
  `lib/__tests__/programs-internal-bundling.test.ts`.
- **`lib/program-public.ts`**: `PublicProgramView` DTO, `toPublicProgramView()`,
  `benefitQualifier()` (the one place the binding qualifier copy is
  generated), `catalogRevisionFromRaw()` (SHA-256 of the raw catalog bytes,
  mirrors `shortlistUniverseChecksum`), and `buildPublicProgramsEnvelope()`.
- **`scripts/export-public-programs.ts`** + npm scripts
  `programs:public:export` / `programs:public:check`. Pure file-to-file
  transform, no DB/network. `--check` regenerates in memory and diffs
  against the committed artifact (ignoring `generatedAt`, the only field
  that legitimately changes between runs), exiting non-zero on drift.
- **`public/data/programs-public.json`** generated and committed:
  `{schemaVersion: 1, generatedAt, catalogRevision, programs: [...71 PublicProgramView]}`.
- **`public/data/programs.json` stays in place, untouched** — no PR1
  consumer reads `programs-public.json` yet; it "ships alongside" per spec.

### Design decisions

- **`whoQualifies` never reaches the DTO.** `screening.publishedCriteria`
  is sourced from each record's structured `eligibilityRules[].description`
  (all 71 records have this populated), not from the free-text
  `whoQualifies` field. `links.administeringAgency` (the first `contacts[]`
  entry's `agency`) is exposed separately so a PR2 consumer can render
  "Published criteria — confirm with `<administeringAgency>`" — the DTO
  provides the structured pieces; the framing sentence itself is a
  rendering-surface concern for PR2, deliberately not baked into the DTO
  as prose (per the spec: "a structured DTO (NOT prose strings)"). A test
  asserts no DTO ever carries the literal `whoQualifies` string anywhere in
  its serialized form.
- **`benefitQualifier()` for `intakeStatus: "unknown"`** (not covered by
  either of the spec's two named buckets) — added a third branch: "Intake
  status not established from published sources as of `<statusAsOf>`."
  Applies to `iraCleanElectricity` and `r3Grants` (see section 1.1's
  table). Never defaults toward open/current language, consistent with the
  binding derivation rule.
- **`catalogRevision`** is a SHA-256 hex digest of the *raw bytes* read
  from `data/programs-internal.json` at export time (not a re-serialization
  of the parsed records), so it changes if and only if the committed file's
  bytes change — deterministic and dependency-free (no git plumbing, no
  DB), consistent with the Hard Rules.
- **Regen-diff CI check has two forms**: the npm-script/shell form
  (`scripts/export-public-programs.ts --check`, for a real CI step or local
  use) and an in-process vitest form
  (`lib/__tests__/program-public.test.ts`) that imports
  `buildPublicProgramsEnvelope` directly rather than spawning the script —
  the one that actually runs under `npx vitest run`. A mutation test proves
  the diff check is not vacuous.

## PR1 — section 1.3: Zone Evidence v2

### What changed

- **`lib/zone-layer-registry.ts`** (new): `ZONE_LAYER_REGISTRY` — one entry
  per checkable zone key (the same 16 keys as `CHECKABLE_ZONE_KEYS`), each
  with `source` (`"static-file" | "db"`), `sourceFile`, `dataRevision`, and
  `verifiedLoaded`. `STATIC_ONLY_ZONE_KEYS` (`nof`, `ccsa`,
  `energyCommunities`, `hubzone`) is a fresh, independently-defined constant
  matching v1's inline `staticOnlyKeys` set in `resolveZonesAtPoint` — not
  imported from it, so v1 stays byte-for-byte untouched.
- **`lib/zones-check.ts`** (additive only — no existing export changed):
  `resolveZoneLayerEvidence()` and `resolveZoneEvidenceV2()`, plus the
  private `checkStaticZoneV2()` / `pointInPolygonSafeV2()` helpers. Every
  layer resolves independently: a malformed feature marks that layer
  `unknown`/`malformed_geometry` (not `not_matched`) only if no real match
  is found first; an unreadable static file is `unknown`/
  `source_unavailable`; a DB query throwing is `unknown`/
  `source_unavailable`; a DB layer returning zero rows is `unknown`/
  `layer_missing` unless the registry marks it `verifiedLoaded`, in which
  case it's a genuine `not_matched`. `opts.sql` / `opts.dbLayerQuery` are
  injectable so every DB-path scenario is testable without a live database
  (Hard Rule: mock at the `getSQL` boundary).
- **`app/api/zones/check/v2/route.ts`** (new route): the exact envelope
  from the spec — `{schemaVersion: 2, dataRevision, checkedAt,
  requestedLayers, layers}`, no redundant `checked[]`/`unknown[]` arrays.
  `/api/zones/check` (v1) is completely untouched.
- **`lib/zone-evidence-cache.ts`** (new): `zones:check:v3:` Redis
  namespace, keyed by `(schemaVersion, dataRevision, roundedCoord,
  sortedRequestedLayers)`. Fully-covered results get the normal 7-day TTL;
  any result containing an `unknown` layer gets a 5-minute TTL. The route
  independently sets `Cache-Control: no-store` on the HTTP response
  whenever any layer is `unknown`.
- **`lib/zone-response.ts`**: added `normalizeZoneEvidenceV2()` (parses the
  new v2 shape) and an **additive** `unknownLayers: string[]` field on
  `normalizeZoneCheckResponse()`'s (v1) return value — see "Decisions"
  below for why this is additive rather than a literal value flip.

### Decisions not fully specified by the build spec

- **The v1 normalizer's `zones[key]` values still default to `false` for
  omitted layers; a new `unknownLayers: string[]` field lists which keys
  were actually omitted, additively.** The spec's literal text says
  "map every omitted layer to unknown (never false)". Implementing that
  literally means widening `NormalizedZoneCheck.zones` to
  `Record<string, boolean | "unknown">`. Six files consume this type/
  function (`app/report/page.tsx`, `components/map/MapView.tsx`,
  `lib/zone-check.ts`, `lib/owner-file-letter-context.ts`,
  `lib/watchlist-digest.ts`, plus its own test) and none of them are
  allowed to change in PR1 (Hard Rule: "Do NOT change any consumer").
  Widening the value type is not safe to do silently: any current
  consumer doing a *truthy* check on `zones[key]` (e.g. `if (zones.tif)`)
  would start treating an *omitted* layer as truthy — i.e. it would flip a
  currently-suppressed claim into a **false positive**, which is a worse
  defect than the false-negative F2 describes, not a fix for it. The
  audit's own minimal fix for F2 is "suppress negative summaries when any
  required layer is unknown" — that requires a consumer to actively check
  for unknown-ness before rendering, which is exactly what
  `unknownLayers` gives PR2 to wire up, without silently changing any PR1
  consumer's current behavior. This is flagged here explicitly because it
  is a deliberate, reasoned deviation from one literal sentence in the
  spec, made to honor a stronger, more specific constraint elsewhere in
  the same spec (and the standing Hard Rule) — not an oversight.
- **`STATIC_ONLY_ZONE_KEYS` is a second, independently-defined copy** of
  v1's inline `staticOnlyKeys` set in `resolveZonesAtPoint`, rather than a
  shared import, specifically so that touching v1's function to extract a
  shared constant (a behavior-neutral refactor, but still a v1 edit) is
  never necessary. Both sets are asserted to be `{nof, ccsa,
  energyCommunities, hubzone}` by inspection; a future PR2 change to
  either one only needs to keep them in sync deliberately, not because of
  a hidden coupling.
- **Zone Evidence v2 caching is Redis-only** (no process-level L4 memory
  cache like `memCached`'s). `memCached()`'s single fixed TTL, chosen
  before the wrapped function runs, cannot express "TTL depends on
  whether the result turned out to contain an unknown layer" — so
  `lib/zone-evidence-cache.ts` implements its own read-then-conditional-
  write against Redis directly instead of reusing `memCached`.

## PR1 — section 1.4: PR1 adversarial tests

_To be filled in as 1.4 is implemented._

## F1–F16 acceptance matrix

This table is the PR's acceptance contract in place of a Linear issue. PR1
does not touch consumers, so every row starts "not started" except where a
PR1 producer directly addresses part of a finding (noted). PR2 fills in the
rest.

| Finding | Mechanism | Files | Test(s) | Status |
|---|---|---|---|---|
| F1 vacancy report determination copy | Copy sweep (binding replacement) | `app/vacancy/[zip]/report/page.tsx`, `lib/vacancy-index-adapter.ts`, `lib/vacancy-index-pdf.ts` | TBD PR2 | Not started (PR2 2.4) |
| F2 zone layer failures → false negatives | Zone Evidence v2 | `app/api/zones/check/v2/route.ts`, `lib/zones-check.ts`, `lib/zone-response.ts`, `lib/zone-layer-registry.ts` | `lib/__tests__/zone-evidence-v2.test.ts` (PR1 1.4) | **Producer done in PR1**; consumer cutover PR2 2.3 |
| F3 unlock/gate/access framing | Copy sweep | `app/programs/[slug]/page.tsx`, `components/programs/ProgramsCatalog.tsx`, homepage CTA | TBD PR2 | Not started (PR2 2.4) |
| F4 unavailable programs shown as "available" | PublicProgramView + catalog status fields | `lib/program-public.ts`, `data/programs-internal.json`, `ProgramsCatalog.tsx` | `lib/__tests__/program-eligibility-fields.test.ts`, `lib/__tests__/program-public.test.ts` (PR1) | **Schema + DTO producer done in PR1**; consumer cutover PR2 2.2 |
| F5 raw benefit terms as current | PublicProgramView benefit qualifier | `lib/program-public.ts` | `lib/__tests__/program-public.test.ts` (PR1) | **Producer done in PR1**; consumer cutover PR2 2.2 |
| F6 FAQ facts drift from catalog | `programFact()` helper + rewrite | TBD PR2 | TBD PR2 | Not started (PR2 2.2) |
| F7 Answers content: closed funding as usable | `programFact()` helper + rewrite | `lib/answers-data.ts` | TBD PR2 | Not started (PR2 2.2) |
| F8 "Eligibility is geographic" framing | Copy sweep | `lib/answers-data.ts`, `app/neighborhoods/[slug]/incentives/page.tsx` | TBD PR2 | Not started (PR2 2.4) |
| F9 quiz facts drift from catalog | `programFact()` helper + rewrite | `lib/quiz-bank-extension.ts` | TBD PR2 | Not started (PR2 2.2) |
| F10 zoning routed to generic City/professional instead of ZBA | `lib/authority-routing.ts` typed registry | TBD PR2 | TBD PR2 | Not started (PR2 2.4) |
| F11 overlap presented as stacking proof | Copy sweep (binding replacement) | `app/faq/page.tsx`, `lib/answers-data.ts` | TBD PR2 | Not started (PR2 2.4) |
| F12 survey inert options / no availability gate | Survey honesty rewrite | `components/survey/SurveyResults.tsx`, `lib/survey-engine.ts` | TBD PR2 | Not started (PR2 2.6) |
| F13 "verify eligibility" report sources copy | Copy sweep (binding replacement) | `app/report/page.tsx`, `components/report/ReportDisplay.tsx` | TBD PR2 | Not started (PR2 2.4) |
| F14 email program-count mislabeled as section count | `programCount()` shared helper | `components/report/ReportModals.tsx`, `components/map/MapPolygonPanel.tsx`, `app/api/email-report/route.ts` | TBD PR2 | Not started (PR2 2.4) |
| F15 legacy coordinate-less business path | AddressSearch geocode-then-route fix, then delete legacy fork | `components/lookup/AddressSearch.tsx` | TBD PR2 | Not started (PR2 2.7) |
| F16 dead CheckResults component | Deletion | `components/check/CheckResults.tsx`, `components/lookup/ProgramResultCard.tsx` | TBD PR2 (reachability test) | Not started (PR2 2.7) |

## Decisions not fully specified by the build spec

- **New fields kept optional on the `Program` TS type and `ProgramSchema`
  Zod schema**, rather than required. `app/api/programs/route.ts` builds
  `Program` objects directly from Postgres rows (`SELECT id, name, level,
  ...`) without these five fields, and the Hard Rules for this task
  prohibit any DB work in PR1. Making the fields required in the shared
  type/schema would either break that DB path's type-checking or force an
  unrelated DB-schema change outside this task's scope. Catalog
  completeness (all 71 static-catalog records have all five fields) is
  instead enforced by a dedicated test
  (`lib/__tests__/program-eligibility-fields.test.ts`), which is the
  concrete, checkable version of the spec's "every record has the new
  fields with valid values" requirement (section 1.4).
- **`sunset` status → `intakeStatus: lapsed`.** The `IntakeStatus` enum in
  the build spec has no dedicated "terminated" value; `lapsed` is the
  closest fit for `sec179d`, whose IRS termination date has already
  passed for new construction.
