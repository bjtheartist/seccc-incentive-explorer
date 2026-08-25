# Corporate giving source and ingestion plan

Status: research and implementation contract, 2026-08-24
Scope: Chicago community-investment records only
Evidence rule: primary or official publisher sources only

## Recommendation

Build the first `Corporate giving` category from the corporate-foundation grants
that are already in the repository's reconciled IRS 990 pipeline, then add a
small number of direct-company award programs only after a legal-vehicle and
duplicate check.

The existing export already contains 1,182 reviewed, itemized grant rows totaling
$57,170,452 from 14 company-affiliated foundations or charitable trusts. Of
these, 848 are point-sited and 334 are held citywide. Those rows are the safest
first release because their grant schedules already passed the repository's
filing reconciliation, address review, quarantine, and stable-identity gates.
This is a classification change, not a new dollar import.

Do **not** make corporate giving a synonym for private development, corporate
sponsorship, an ESG headline, or an in-kind valuation. A corporate cash grant is
grant-class capital. A self-reported development project price remains private
development. The two must never be combined.

## Contract fit

The current contract in `lib/community-investment.ts` has:

- `funderType`: `government | philanthropic | private_development`
- `capitalClass`: `grant | tif_subsidy | federal_program | tax_credit |
  state_appropriation`
- an exhaustive `SOURCE_FUNDER_TYPE` mapping, guarded by tests that expect a
  record's source and funder type to agree

The long-term normalized-source extension is:

```ts
type FunderType =
  | "government"
  | "philanthropic"
  | "corporate"
  | "private_development";

type InvestmentSource =
  | ExistingInvestmentSource
  | "corporate-foundation"
  | "corporate-direct";

SOURCE_FUNDER_TYPE["corporate-foundation"] = "corporate";
SOURCE_FUNDER_TYPE["corporate-direct"] = "corporate";
SOURCE_CAPITAL_CLASS["corporate-foundation"] = "grant";
SOURCE_CAPITAL_CLASS["corporate-direct"] = "grant";
```

For the first release, the analysis layer uses the committed, EIN-backed
`corporate_foundation_registry.json` to classify these already-audited
`source: foundation` rows as `Corporate giving`. That preserves the current
export hash and the foundation sample audit while making the neighborhood
breakdown and Sankey tabulate the category immediately. A later export-schema
migration can move them to `corporate-foundation` only when the content-hash,
exclusion-ledger, and sample-audit bindings are regenerated together.

`corporate-foundation` means a tax-exempt company-affiliated grantmaking vehicle
whose IRS grant rows are itemized and reconciled. `corporate-direct` means an
award whose legal funder is an operating company or a company program, not its
foundation. The distinction prevents an announcement and the later foundation
filing from becoming two records for one grant.

## Priority 1: reclassify the reviewed IRS rows already present

The IRS publishes Form 990-series filing indexes and returns as downloadable
XML, including annual index CSVs and monthly/yearly ZIP archives. The repository
already parses that source and reconciles itemized grant rows to each filing's
control total. See the [IRS Form 990-series downloads](https://www.irs.gov/charities-non-profits/form-990-series-downloads)
and [IRS TEOS bulk-download documentation](https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads).

### Publishable registry

The exact names below occur in `data/private/community-investment.json`. EINs
come from the existing Phase 2/3 review ledgers. The final column is independent
official evidence that the vehicle is associated with the named company.

| EIN | Exact export name | Official corporate/vehicle evidence |
| --- | --- | --- |
| 36-3337340 | Aon Foundation | [Aon Foundation goals](https://www.aon.com/usa/about-aon/aon-foundation-goals) |
| 91-6056738 | Boeing Company Charitable Trust | [Boeing community engagement](https://www.boeing.com/company/community-engagement) |
| 45-0575574 | CME Group Foundation | [CME Group Foundation: who we are](https://www.cmegroupfoundation.org/about.html) |
| 20-1734765 | DRW Foundation | [DRW community investment](https://www.drw.com/community-investment) |
| 83-0499473 | Exelon Foundation | [Exelon Foundation](https://www.exeloncorp.com/community/foundation) |
| 46-2918450 | Hyatt Hotels Foundation | [Hyatt community partner hub](https://www.hyatt.com/world-of-care/en-US/risehy/community-partner-hub) |
| 36-3165216 | Katten Muchin Rosenman Foundation INC | [Katten Cares](https://katten.com/katten-cares) |
| 46-0858318 | Kraft Heinz Company Foundation | [Kraft Heinz 2022 ESG report](https://www.kraftheinzcompany.com/sustainability/pdf/KraftHeinz-2022-ESG-Report.pdf) |
| 84-4058990 | LKQ Community Foundation | [LKQ community foundation](https://lkqcorp.com/always-delivers/) |
| 20-3881590 | Mondelez International Foundation | [Mondelez International Foundation](https://www.mondelezinternational.com/snacking-made-right/mondelez-international-foundation/) |
| 20-3980527 | Sidley Austin Foundation | [SidleyGives](https://www.sidley.com/en/sidleygives) |
| 47-1330583 | The Clayco Foundation | [Clayco Foundation announcement](https://claycorp.com/latest/clayco-foundation-announces-formation-of-juneteenth-program-and-juneteenth-advisory-committee) |
| 36-6007812 | The Kemper Foundation | [Kemper philanthropy](https://www.kemper.com/about-kemper/Philanthropy) |
| 84-6025403 | Woodward Governor Charitable Trust | [Woodward sustainability report](https://www.woodward.com/wp-content/uploads/sites/2/2025/12/W-_-SustainabilityReport_2023_Edited.pdf) |

The registry's authoritative identity is the EIN, not the display name. The
current canonical export does not yet carry filer EIN on each record, so the
first-release classifier matches only the exact reviewed export names listed
here. The future source-schema migration must persist EIN and switch the join
to that durable key; fuzzy name matching is never allowed.

### Holds that must remain holds

| EIN | Vehicle | State | Required treatment |
| --- | --- | --- | --- |
| 36-3092291 | William Blair & Company Foundation | Aggregate-only IRS schedules | Do not publish or treat the aggregate as zero. Keep as an itemization-exchange target. |
| 84-2220090 | Northern Trust Foundation | Attachment-only aggregate rows at the filer's own address | Keep quarantined. Northern Trust's [official foundation page](https://www.northerntrust.com/united-states/about-us/corporate-social-responsibility/corporate-philanthropy/foundation) confirms the program but does not supply the missing award-level ledger. |
| 43-6316003 | Emerson Directors & Officers Charitable Trust | Corporate-foundation flag but no Chicago recipient rows in the reviewed expansion | Do not manufacture a Chicago row. Emerson's [official giving page](https://www.emerson.com/en/corporate/about-us/charitable-giving) corroborates its charitable trust only. |

### Refresh cadence and access

- Filing grain: one grant-schedule line in one 990/990-PF filing.
- Amount meaning: a filed grant amount, not proof of receipt or expenditure.
- Geography: the grantee address printed in the filing, subject to the existing
  filer-address, intermediary, geocode, and Chicago-boundary gates.
- Cadence: poll the official IRS index monthly; each organization files annually
  and may lag the activity year.
- Access: index CSV plus filing XML from the IRS download archives.
- Duplicate risk: high against company press releases and recipient
  announcements; low within the existing IRS stream because the repository
  already maintains filing object ID, schedule part, row ordinal, stable ID, and
  a dedupe review ledger.

## Priority 2: direct-company programs with award-level evidence

These sources can add genuinely new corporate giving after the IRS registry is
live. They are not equally complete, and none should bypass the same source
honesty gates.

| Source | Grain and amount meaning | Geography | Cadence/access | Decision and duplicate risk |
| --- | --- | --- | --- | --- |
| [Comcast RISE Chicago and Cook County, 2021](https://corporate.comcast.com/stories/local/illinois/comcast-rise-investment-fund-awards-1-million-in-grants-to-100-bipoc-owned-small-businesses-in-chicago-and-cook-county) | Complete named roster on the official company page; every listed business is explicitly awarded $10,000; 100 rows and $1 million overall | City only on the roster, not street address. Filter literal `Chicago`; never assign a suburb to Chicago | One-time/static HTML table | Best first direct-program pilot. Verify the legal paying vehicle, then crosswalk against later 990 rows before release. Match exact recipient names to the official Chicago business-license API only as an address-enrichment candidate; ambiguous matches stay citywide. |
| [Bank of America Chicago 2022](https://newsroom.bankofamerica.com/content/newsroom/press-releases/2022/12/bank-of-america-commits--13-million-to-chicago-area-nonprofits-w.html) | The two named Neighborhood Builders each have an explicit $200,000 award. The $13 million/100+ headline is aggregate-only and cannot be allocated to the other named organizations | Chicago-area market; usually no award-site address | Episodic official newsroom HTML | Ingest only rows with a recipient-specific amount. High overlap risk with Bank of America Charitable Foundation filings; announcement rows must be provisional until EIN/program crosswalk. |
| [Bank of America / After School Matters, 2025](https://newsroom.bankofamerica.com/content/newsroom/press-releases/2025/12/bofa-awards--1-million-grant-to-after-school-matters.html) | One explicit $1 million grant for the Orleans Teen Center; the same page also states a separate 2024 $200,000 Neighborhood Builder award | The source identifies the funded facility and Cabrini community, making this unusually strong neighborhood evidence | One official newsroom page | High-quality one-off candidate, but store the two awards separately by year/program and check the foundation filing before adding. |
| [CME Group Foundation grant pages](https://www.cmegroupfoundation.org/grants.html) | Recipient-level pages can publish exact amounts and purposes; for example, its [special-opportunities roster](https://www.cmegroupfoundation.org/grants/special-opportunity.html) lists amounts | Recipient/program text varies; many rows are citywide institutions | Official HTML, updated by program/year | Use as a timelier corroboration stream for an already registered corporate foundation, not an additive second dataset. When a later 990 row matches, retain one canonical award with both links. |

### Address enrichment for company-program business recipients

The City publishes [Business Licenses](https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses/r5kz-chrr)
and [Current Active Business Licenses](https://data.cityofchicago.org/Community-Economic-Development/Business-Licenses-Current-Active/uupf-x98q)
through Socrata. These datasets are appropriate only as a second-source address
crosswalk for an already named corporate award recipient.

Required matching posture:

1. Match normalized legal name or DBA plus source city.
2. Accept one unambiguous Chicago business account/site match.
3. Send multiple, fuzzy-only, stale, or no-match cases to manual review.
4. Preserve both the award source and the City license record ID.
5. Geocode the matched address and require containment in an official community
   area polygon.
6. Never convert a City-only roster to a downtown or ZIP centroid.

The license dataset is refreshed daily, but that does not make a present-day
license address proof of the award location in an earlier year. The location
record must say that it is an enrichment and retain its effective-date caveat.

## Priority 3: useful rosters that are count-only unless strengthened

| Source | What it establishes | Why dollars cannot yet be tabulated |
| --- | --- | --- |
| [Exelon 2025 grant-recipient list](https://www.exeloncorp.com/content/dam/exelon/community/Documents/Grant%20Recipients.pdf) | An annual official roster of organizations receiving one or more grants from Exelon and its operating companies | The PDF mixes Exelon, its utilities, and the Exelon Foundation and does not publish recipient-level amounts or payer identity. Use for coverage checks and count-only records only after dedupe; do not distribute the corporate/foundation headline across names. |
| [ComEd Powering Communities programs](https://poweringlives.comed.com/power-your-community-with-more-than-electricity/) | Official program descriptions and links to annual Green Region, Powering Safe Communities, and Powering the Arts recipients | The public description says grants are up to $10,000, not that every recipient received $10,000. Amounts remain null unless a recipient-specific official source gives the exact figure. Partner administration also creates pass-through duplication risk. |
| [Chicago Bulls Charities 2026 grantees](https://www.nba.com/bulls/news/chicago-bulls-charities-nightcelebrateschangemakers-in-thecommunity) | A current official team roster of 22 grantees | No recipient amounts. The charitable arm and partner funds may also appear in 990 or intermediary records, so this is count-only and high-dedupe-risk. |
| [Chicago Sports Alliance 2025](https://www.nba.com/bulls/news/chicago-professional-sports-franchises-come-together-to-address-gun-violence-for-eighth-consecutive-year) | Three named organizations and a published $1.5 million combined grant pool | The announcement does not allocate the full pool by recipient and identifies a McCormick Foundation fund, so it is an intermediary/pass-through case. Never split the pool evenly. |

## Sources not suitable for neighborhood award rows

### SEC EDGAR

The SEC provides unauthenticated JSON APIs for company submissions and XBRL
facts, plus nightly bulk archives. See the [official EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
This is excellent for finding a company's filing history, but ordinary 10-K/10-Q
disclosures usually contain aggregate philanthropy, commitments, sponsorship,
or ESG context rather than recipient-level Chicago awards. Use EDGAR as a
corroboration and discovery source, not as a neighborhood-grant ledger.

### Corporate ESG and impact-report totals

Reject an aggregate unless it names one recipient and one exact cash amount.
Never allocate a companywide, national, state, Chicago-market, employee-giving,
cash-plus-in-kind, or multi-program total across organizations or neighborhoods.
In-kind services, equipment, volunteer hours, donated travel, advertising, and
gift cards stay count-only unless the product later adds a separate non-cash
value model. They do not enter `amountAwarded`.

### Political contributions and sponsorship spend

Political-contribution files do not measure community grants. Sponsorships may
be commercial consideration rather than charitable grants. Keep both outside
the corporate-giving awarded total unless an official award document clearly
identifies a charitable cash grant.

## Minimal ingestion schema

The source capture should contain enough information to map to
`CommunityInvestmentRecord` without inventing facts. The fields below can live
in a curated CSV plus a small corporate-vehicle registry.

```ts
interface CorporateGivingInput {
  sourceRecordId: string;
  sourceProgram: string;
  sourceUrl: string;
  sourcePublishedAt: string | null;
  sourceCheckedAt: string;

  payerName: string;
  payerEin: string | null;
  parentCompany: string;
  vehicle:
    | "corporate_foundation"
    | "charitable_trust"
    | "operating_company"
    | "company_program"
    | "unknown";

  recipient: string;
  awardYear: number | null;
  amountAwarded: number | null;
  amountEvidence:
    | "recipient_exact"
    | "program_fixed_per_recipient"
    | "aggregate_only"
    | "cap_only"
    | "unavailable";
  supportKind: "cash_grant" | "in_kind" | "sponsorship" | "mixed" | "unknown";
  purpose: string | null;

  publishedAddress: string | null;
  publishedCity: string | null;
  publishedState: string | null;
  publishedPostalCode: string | null;
  locationBasis:
    | "source_award_site"
    | "source_recipient_address"
    | "official_business_license_match"
    | "recipient_hq_only"
    | "city_only"
    | "unavailable";
  locationSourceUrl: string | null;
  locationSourceRecordId: string | null;

  possibleDuplicateOf: string | null;
  duplicateState: "clear" | "linked_same_award" | "possible" | "unreviewed";
  reviewState: "ready" | "hold" | "quarantined";
  reviewNote: string | null;
}
```

Canonical mapping rules:

- `vehicle` corporate foundation/charitable trust -> source
  `corporate-foundation`.
- `vehicle` operating company/company program -> source `corporate-direct`.
- `capitalClass = "grant"` only for cash grants.
- `amountAwarded` is populated only for `recipient_exact` or a program whose
  official terms explicitly make the same fixed cash award to every listed
  recipient.
- `governmentFundingPurpose = null` for every corporate record.
- `status = "awarded"` only when the source says awarded/received a grant; an
  open application, planned commitment, or eligibility page is not an award.
- An amount-null row may count as documented corporate activity, but it cannot
  enter any dollar total or Sankey weight.

## Duplicate and flow rules

1. **Announcement before filing:** ingest an exact company announcement as a
   provisional award. When a later 990/990-PF row has the same payer vehicle,
   recipient, amount, award year/fiscal period, and compatible purpose, retain
   one canonical record and both links.
2. **Foundation versus parent company:** do not assume two similarly named
   entities are the same payer. Resolve the EIN or a source-explicit statement.
3. **Intermediary flow:** a company grant to a community foundation and that
   foundation's later subgrant are different stages of one flow. Link them and
   do not add both to one gross neighborhood total.
4. **Employee matching:** the foundation's matching payment can be a grant; the
   employee's original donation is not a second company award.
5. **Same recipient, same year, same amount:** this is a duplicate candidate,
   not proof of duplication. Preserve distinct filed rows when the filing itself
   supports multiple line items, using the existing dedupe flag.
6. **Corrections and reversals:** keep the source row but null or quarantine its
   amount under the same rules used by the foundation pipeline; never silently
   net a negative correction into an awarded headline.

## Ingestion sequence

1. Add the `corporate` funder type, label/color, neighborhood breakdown, and
   Sankey coverage.
2. Commit an EIN-keyed registry for the 14 publishable vehicles and the three
   explicit hold/zero states above.
3. Classify the 1,182 existing canonical foundation rows through that registry
   in the analysis layer. The awarded grand total must not change; only the
   funder-type split changes.
4. Add tests proving the 14-funder registry count and $57,170,452 reconciliation,
   plus explicit exclusions for William Blair, Northern Trust, and Emerson.
5. In a later schema migration, add the `corporate-foundation` and
   `corporate-direct` sources and regenerate every export-bound audit artifact
   together.
6. Implement the Comcast RISE 2021 parser as the first `corporate-direct` pilot,
   but hold rows until payer-vehicle and duplicate review is complete.
7. Add the official Chicago business-license crosswalk with an exact/ambiguous/
   no-match ledger and preserve citywide geography when a point cannot be
   defended.
8. Add Bank of America exact one-offs and CME announcement corroboration using
   the announcement-to-filing linkage, not additive imports.
9. Run a quarterly official-company sweep and a monthly IRS index refresh.

## Release gates

A corporate source may ship only when all applicable checks pass:

- exact source URL and source-check date retained;
- payer legal vehicle resolved or explicitly held `unknown` and not published;
- recipient-specific amount meaning classified;
- aggregate/cap/in-kind figures excluded from `amountAwarded`;
- Chicago scope supported by source text or a reviewed official crosswalk;
- neighborhood point supported by a real address and polygon containment;
- announcement/990/intermediary duplicate review completed;
- every amount-bearing filing or complete roster reconciles to its own control
  total where one exists;
- zero, unavailable, malformed, quarantined, and count-only remain distinct;
- existing combined-total firewall and Sankey invariants remain green.

No source capture is added with this plan. Comcast is small enough to parse, but
its paying vehicle and overlap with later foundation filings must be resolved
first. The Exelon and ComEd rosters are official but do not publish enough
recipient-level amount and payer detail to justify additive dollar records.

## Seed release 2026-08-25

Steps 6-8's data seeding: the captured, verified, deduped corporate-direct +
corroboration + count-only records now exist as curated inputs with loaders
and release-gate tests. Step 5 (canonical export schema migration, adding the
`corporate-direct`/`corporate-foundation` sources to
`lib/community-investment.ts`) is still pending — nothing in this release
touches the canonical export, its content hash, or the awarded grand total.

**5 sources PASS (2 of those HELD on payer vehicle) + 1 corrected on
adversarial verification** (capture + an independent re-fetch/re-parse verify
pass per source):

- Comcast RISE 2021 — PASS. Full 100-recipient/$1,000,000 roster reconciles
  exactly; 74 Chicago rows ($740,000) seeded, 26 suburban Cook County rows
  excluded per the city-only filter.
- Bank of America 2022 Neighborhood Builders — PASS, **HELD on payer
  vehicle**. 8 named organizations captured against a "more than 100"/$13M
  aggregate headline; the 2 recipient-specific $200,000 awards are
  dollar-bearing, captured, and seeded, but `reviewState=hold` — first
  refresh task below.
- Bank of America / After School Matters 2025+2024 — PASS, **HELD on payer
  vehicle**. Both explicit awards ($1,000,000 Orleans Teen Center 2025;
  $200,000 Neighborhood Builder 2024) captured as two separate awards,
  `reviewState=hold` — first refresh task below.
- CME Group Foundation roster corroboration — PASS (2 MINOR findings, both
  addressed: a $10,000 cross-roster double-count and a declared education-
  roster deferral). 306 rows captured across the Special Opportunities,
  Violence Reduction and Intervention, and COVID-19 Response rosters (the
  education rosters — 399 rows, $40.8M — were parsed but are explicitly
  deferred, not part of this seed).
- Chicago Bulls Charities + Chicago Sports Alliance (count-only) — PASS. 22
  Bulls Charities Night 2026 grantees + 3 Chicago Sports Alliance 2025
  recipients, all count-only.
- Exelon 2025 Grant Recipients + ComEd Powering Communities (count-only) —
  **corrected on verify (FAIL -> fixed)**: the verifier found a MAJOR
  completeness miss (the roster's own Chicago/Chicagoland/Illinois/IL
  name-string filter should have caught "PRIDEChicago" but did not) plus a
  filter-consistency violation ("United Way of Kankakee County" was included
  even though its name carries no Chicago/IL string). Both are fixed in the
  seed: PRIDEChicago added, Kankakee dropped, each of the 15 ComEd rows now
  carries its own program-page URL instead of the Exelon PDF's.

**Dedupe summary** (against the 44,061-record canonical export, reviewed at
origin/main @ 38d6300):

- Corporate-direct dollar-bearing rows: 78 total (74 Comcast + 4 BofA), all
  `duplicateState=clear` (no existing Comcast/Bank of America payer in the
  canonical export). Of the 78, 74 are `reviewState=ready` (Comcast) and 4
  are `reviewState=hold` (BofA, payer vehicle unresolved — see below), so the
  release-gate-cleared total is $740,000, not the full $2,340,000 captured.
- Count-only rows: 152 total (112 Exelon + 4 ComEd Green Region + 11 ComEd
  Powering the Arts + 22 Bulls Charities + 3 Chicago Sports Alliance);
  142 `clear`, 10 `possible` (8 Bulls Charities grantees + Chicago CRED's
  sibling CSA rows already carry a canonical Robert R. McCormick Foundation
  990 row in an adjacent year — expected, not booked as a match).
- CME corroboration rows: 302 (of 306 captured — 4 verifier-flagged
  intra-capture duplicate pairs collapsed to one row each, 2 of them
  cross-roster with both source URLs preserved): 79 `linked_same_award`
  (paired to a distinct, unclaimed canonical CME Group Foundation 990 row),
  17 `possible` (amount/entity/fiscal-year ambiguity, human review still
  required), 206 `clear` (mostly pre-2021 rows structurally outside the
  canonical filing coverage window, or out-of-Chicago/national recipients).

**Ruling (2026-08-25 fix round): the release gate wins.** The 4 dollar-bearing
Bank of America rows keep `vehicle=unknown` (the capture and independent
verify pass both concluded the legal payer — Bank of America Charitable
Foundation vs. the operating bank — is unresolved on every official page
checked). This release gate's own text ("payer legal vehicle resolved or
explicitly held `unknown` and not published") is binding and overrides the
first-release build spec's deliverable list, which had shipped them
`reviewState=ready`. All 4 rows are now `reviewState=hold` in
`corporate_direct_awards.csv`, with the reviewNote extended:
"HELD per release gate — payer vehicle unresolved (Bank of America
Charitable Foundation vs operating bank); resolve via 990-PF or an explicit
official statement, then flip to ready." They remain in the awards CSV
(they are dollar-bearing capture rows; the hold flag is the machine-readable
gate) rather than moving to the count-only file. `lib/corporate-direct.ts`
exposes this honestly: `corporateDirectAwards()` returns all 78 rows with
`reviewState` visible per row, and `corporateDirectReadyAwards()` filters to
the 74 `ready` rows only ($740,000) for any caller that must honor the gate.
**First refresh task:** resolve the legal payer via the Bank of America
Charitable Foundation's Form 990-PF (which itemizes Neighborhood Builders
grants by recipient) or an explicit official statement, then flip these 4
rows to `ready`.

**Deviation: `data/curated/investment-inputs/manifest.json` is deliberately
NOT updated in this PR.** The manifest is hash-bound to the canonical
export: `scripts/lib/investment-manifest.ts`'s `manifestContentHash()` folds
in every declared source (including HELD ones never read by the exporter),
and `data/private/community-investment.json`'s `meta.sourceManifestHash` +
`foundation_audit_fresh.json`'s `bound_manifest_hash` both pin that hash —
enforced by `lib/__tests__/investment-manifest-hash-equality.test.ts`. Adding
these 4 curated files as new `AUTHORED_SOURCES` entries (even purely
documentary "held" ones, the `impact-grants-held` pattern) changes that hash
and fails the equality test unless the canonical export and the foundation
audit are regenerated in the same commit — exactly what this PR's hard rule
forbids ("the canonical export, its content hash, and the awarded grand
totals must not change in this PR"). The four curated CSVs therefore ship
without a manifest entry; add them to `AUTHORED_SOURCES` in the same PR that
performs ingestion step 5's export-schema migration, when a full
export/audit regeneration is already in scope.
