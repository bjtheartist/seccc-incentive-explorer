# Data Quality Notes

## 2026-05-16: SSA #50 label shown for Englewood locations

Root cause: the SSA zone geometry correctly identified Go Green Community Fresh Market at 1207 W. 63rd St. as the Englewood SSA, but the single platform program record for SSAs was hard-coded as `Special Service Area (SSA #50)` with Calumet Heights/Avalon and SECCC-specific copy. Any address inside any SSA could therefore display SSA #50 language.

Fix:
- The SSA program record is now citywide/generic.
- SSA feature names now combine the local SSA name and number when both are available, for example `Englewood (SSA #80)`.
- The zone-check API formats SSA names from `feature_properties.description` when available, including database-backed responses.
- Regression tests assert that Go Green Community Fresh Market resolves to `Englewood (SSA #80)` and that the generic SSA program does not contain SSA #50-specific copy.

Guardrail: do not put neighborhood-specific names, service providers, or phone numbers into a citywide program record. If provider-specific CTA language is needed later, add it as a separate lookup keyed by the detected zone feature, not by the generic `ssa` program.

Follow-up: production `/api/programs` can use the optional database and Redis cache before static fallback. If the database seed is older than `public/data/programs.json`, stale rows can override corrected static program copy. The programs API now prefers static definitions for known program ids and only appends DB-only programs. The Redis cache key was versioned from `programs:all` to `programs:all:v2` to bypass older cached rows.

## 2026-06-04: TIF district finance context

Source: TIF finance context comes from the City of Chicago Data Portal dataset `Tax Increment Financing (TIF) Annual Report - Analysis of Special Tax Allocation Fund` (`qm7s-3ctt`). The point lookup uses the local TIF boundary layer to identify the district, normalizes boundary IDs such as `T- 87` into City finance IDs such as `T-087`, then fetches the latest annual report row for that district.

Behavior:
- Reports show TIF finance only when an address is inside a matched TIF boundary.
- The visible figure is labeled as a latest reported district fund balance.
- The report also shows report year, district expiration from the boundary layer when available, and selected annual-report fields such as reported project-cost designation, debt/obligation designation, surplus/deficit, and surplus distribution.

Guardrail: never describe TIF annual-report balances as available funds, remaining funds, grantable dollars, or money reserved for a specific business/property/project. TIF balances may already be restricted, obligated, programmed, subject to surplus decisions, or dependent on DPD/City Council review. Treat this as district-level fiscal context that helps a user ask better questions, not as eligibility proof or a funding commitment.

Follow-up: OIG's TIF dashboard source guide documents additional corrections around mistyped values, inconsistent fund-balance reporting, and expiration-year reconciliation. If the Explorer later adds a full TIF cash-flow dashboard or district comparison tool, add an explicit correction table and QA flags before publishing broader comparisons.
