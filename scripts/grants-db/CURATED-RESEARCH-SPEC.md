# Active Grants Database — research spec (shared by all tier agents)

Date of record: **September 11, 2026 (America/Chicago)**. Every deadline judgment uses this date.

## Goal
Build the rows for a database of grants that are ACTIVE right now for Chicago small businesses, commercial property owners, nonprofits/community organizations, and startups (Southeast Chicago Chamber of Commerce audience; citywide, statewide, and national programs count if a Chicago applicant can apply). Research only. Do NOT create accounts, submit anything, send anything, or edit any repo file.

## What counts as ACTIVE (include)
- `open`: accepting applications today, with a published close date.
- `rolling`: accepting applications on an ongoing basis (until funds run out / no fixed deadline).
- `scheduled`: not open today, but the sponsor has PUBLISHED a specific upcoming open date or deadline within the next 6 months (e.g., SBIF district windows, NOF Nov 13, CDG Feb 16).
- `closing_soon`: open and closes within 21 days (still `open`; set `closingSoon: true`).

## What does NOT count (exclude from `active`; list under `checkedNotActive` so nobody re-checks)
- Closed with no announced next round ("check back", "2025 window closed").
- Programs whose page still shows an old year's deadline with no current cycle.
- Tax credits, tax abatements, and property-tax classifications (not grants).
- Loans, loan guarantees, and linked deposits (not grants). Exception: 0% forgivable or grant-like programs, flagged as instrument `forgivable_loan`.
- Programs restricted to governments, school districts, or universities as applicants.
- Anything you could not verify on a live official page today (goes under `unconfirmed`, with the reason).

## Instruments to include
`grant`, `rebate`, `reimbursement` (e.g., SBIF, utility incentives, training reimbursement), `in_kind` (donated repairs/services), `award_drawing` (sweepstakes-style cash awards; still include, flagged), `forgivable_loan`.

## Cadence vocabulary (the categorization the Chamber asked for)
- `one_time`: a single window; when it closes the program is gone (disaster declarations, one-off funds).
- `recurring_scheduled`: recurs with a PUBLISHED calendar (SBIF district windows, NOF quarterly, CDG annual, Awesome Foundation monthly).
- `recurring_unscheduled`: known to recur but the next window is not yet published ("both" time-bound and recurring; e.g., a program between rounds with a public statement it will return).
- `rolling`: always open until funds are exhausted (SSA facade rebates, NASE, Kiva-style).
- `rolling_with_cutoff`: apply anytime but a hard cutoff or prerequisite date exists (Verizon Digital Ready: apply anytime in 2026, courses by Dec 7).

## Legitimacy vocabulary
`official` (government/utility/established nonprofit, free), `pay_to_apply` (fee or paid membership required), `lead_gen` (a lender/vendor funnel), `sweepstakes` (random drawing), `unverified`.

## Row schema (JSON). Required fields are marked *.
```json
{
  "id": "kebab-case-unique-id*",
  "name": "Program name*",
  "sponsor": "Administering organization*",
  "level": "City|County|State|Federal|Utility|Private|Foundation|Nonprofit*",
  "instrument": "grant|rebate|reimbursement|in_kind|award_drawing|forgivable_loan*",
  "status": "open|rolling|scheduled*",
  "closingSoon": false,
  "cadence": "one_time|recurring_scheduled|recurring_unscheduled|rolling|rolling_with_cutoff*",
  "window": { "opensAt": "YYYY-MM-DD or null", "closesAt": "YYYY-MM-DD or null", "closesAtTime": "e.g. 17:00 America/Chicago or null", "label": "e.g. Q4 2026 round" },
  "nextWindow": { "expected": "YYYY-MM-DD or null", "note": "free text or null" },
  "amount": { "min": 0, "max": 250000, "display": "Up to $250,000*", "share": "e.g. 75% of eligible costs or null" },
  "eligibility": {
    "summary": "One or two sentences*",
    "entityTypes": ["for_profit","nonprofit","property_owner","individual"],
    "geography": "e.g. Citywide Chicago | SSA #50 | Cook County | Illinois | US*",
    "stage": "any|pre_revenue_ok|operating_6mo|operating_1yr|established",
    "sectorsIncluded": [], "sectorsExcluded": [],
    "useOfFunds": ["building_improvements","equipment","working_capital","training","facade","energy","marketing","other"],
    "demographicRestriction": "none|women|minority|veteran|other (state it)",
    "sizeLimits": "e.g. <500 employees; revenue < $9M; or null",
    "keyExclusions": "e.g. daycare/social services excluded; home-based businesses excluded"
  },
  "costToApply": "free|fee: $X|membership: $X/yr",
  "legitimacy": "official|pay_to_apply|lead_gen|sweepstakes|unverified*",
  "isNew": true,
  "newBecause": "announced YYYY-MM-DD | first window in 2026 | not in Explorer catalog | null",
  "applyUrl": "https://...",
  "sourceUrl": "https://... (the live page you verified on)*",
  "evidence": "Short quote or paraphrase from the live page that proves status and date (<= 200 chars)*",
  "verifiedAt": "2026-09-11*",
  "explorerCatalogId": "id from data/programs-internal.json if this program is already there, else null",
  "notes": "caveats: stale text on page, timezone unstated, reimbursement-only, stacking conflicts, etc."
}
```

## Verification rules
- Every row's `sourceUrl` must be a page you actually fetched THIS RUN (WebFetch, or curl via Bash if the site 403s bots; chicago.gov often 403s WebFetch and works with curl). No fetch, no row.
- Dates: read the actual date on the page and compare to 2026-09-11. If a page shows a date without a year, say so in `notes` and infer only when a weekday or other evidence pins it.
- Time zones: record what the page says; if unstated, note it.
- Do not infer eligibility from program names. Quote or paraphrase the eligibility text.
- Prefer primary sources (sponsor pages, rules PDFs, Submittable/GATA listings). Aggregator sites (GrantWatch, Hello Alice listings, blogs) can point you to a program but cannot be the `sourceUrl`.
- Use the Chamber's Sept 10 research when it covers a program you would otherwise re-verify. Files: `/Users/billyndizeye/Documents/ChatGPT/Law School/outputs/chamber-followups-2026-09-10/grant-verification.md` and `.../research/01-verification-of-cited-programs.md`, `02-additional-programs-martez.md`, `03-additional-programs-wgn-flag.md`. Those were verified 2026-09-10; you may carry them over with `verifiedAt: "2026-09-10"` and the URL they cite, but re-check anything with a deadline before 2026-09-30.
- Match against the Explorer's internal catalog: `/Users/billyndizeye/seccc-wt/grants-db/data/programs-internal.json` (read `id`, `name`, `intakeStatus`, `nextWindow`, `deadlines`). If your program is there, set `explorerCatalogId`. If the catalog's status disagrees with what you verified, say so in `notes` (this is valuable).

## Output
Write ONE JSON file: `/private/tmp/claude-502/-Users-billyndizeye/393b5c6e-8ff2-4544-ad2c-b8cae4306ede/scratchpad/grants/<tier>.json` with this shape:
```json
{ "tier": "<tier>", "generatedAt": "2026-09-11T..", "active": [ ...rows ], "checkedNotActive": [ {"name","sponsor","sourceUrl","finding"} ], "unconfirmed": [ {"name","sponsor","lead","whyUnconfirmed"} ], "catalogDisagreements": [ {"explorerCatalogId","catalogSays","verifiedToday","sourceUrl"} ] }
```
Validate that the JSON parses (python3 -c "import json;json.load(open(path))") before finishing. Final chat message: under 200 words — counts (active / not active / unconfirmed), the 3 most urgent deadlines, and any catalog disagreements.

Budget: be thorough on your tier, but stop when your source list is exhausted. A tier with few active programs is a valid result; do not pad with closed programs.
