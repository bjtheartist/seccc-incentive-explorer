# Chicago Incentive Explorer: three-month lessons

Period: July 9–October 9, 2026. Prepared October 9. This retrospective uses repository history, audit findings, release evidence and product measurement definitions. It does not claim a new 90-day analytics readout or completed customer interviews.

The strongest lesson is that the Explorer's value depends on making a business's next step trustworthy and understandable. A larger catalog, a map match or a polished report is useful only if the reader understands what the evidence establishes and whom to contact next.

## 1. Program maintenance is an ongoing product responsibility

The [August 9 review](../audit-2026-08-09-reverification.md) reported material changes in 36 of 47 reviewed programs. Today's [89-record audit](program-audit-2026-10-09.md) found another 23 records needing correction. These are different review scopes, not a comparable error-rate trend, but both show that a static catalog ages quickly.

The recurring problems are concrete: a fee-waiver expiry masquerades as a lending deadline; an old application URL redirects successfully to a generic page; a historical award announcement sounds like current intake; a rebate notice describes next year's funding. A live link and a recent file-generation timestamp cannot establish that the offer is available now.

**Operating lesson:** maintain deadline-driven reviews and distinguish source access, substantive terms review and confirmed intake. Preserve unknown status when evidence is missing. Today's date guard reduces stale Open badges but does not replace editorial review.

## 2. Discovery needs both geography and project purpose

The October release expanded the catalog from 71 to 89 records, adding NSF and the DCEO resource set while prioritizing CDG. CDG provides a useful citywide discovery path when mapped SBIF/TIF and NOF coverage are both negative. State lending, advising and research resources also remain useful when there is no local zone match. See the [release reconciliation](../programs/cdg-nsf-dceo-eit-2026-10-09.md).

This ordering follows Billy's intended product direction. We have not established through conversion data that the ordering improves outcomes. NSF's specialized research process belongs in discovery, but its maximum award should not make it the first suggestion for an ordinary storefront project.

**Product lesson:** show common, actionable paths prominently; let specialized programs surface through purpose and industry. Distinguish grants, reimbursements, loans, equity, tax credits and advisory help. A catalog listing is not an eligibility decision.

## 3. Evidence quality must survive every screen and export

August's permit and vacancy work established the importance of distinguishing a valid zero from an unavailable source, and a record of a permit from proof of completed construction. The history includes the August 24 removal of a construction-value overclaim (`bde04db`) and subsequent immutable permit exhibits (`e212aeb`, `901b52c`).

The same principle applies to incentives: a program being relevant to a place is weaker than a project being eligible; a recorded introduction request is weaker than an acknowledged connection; imported funding records are weaker than open application opportunities.

The [September 11 grants release](../grants/production-release.md) documented 30,263 source records but only 11 maintained programs at that release. It explicitly did not call those source records 30,263 active grants. Its scanner routes discoveries to review. Those September counts are historical, not freshly queried October totals.

**Product lesson:** use precise states and show their source and date. A simpler interface should simplify the decision, not erase uncertainty.

## 4. Green tests are useful only when they cover the actual user path

The [September 2 audit](pr-audit-247-251-2026-09-02.md) found real gaps despite passing CI: disclosure metadata with no renderer, retry buttons that did not retry, and cached outages appearing fresh. Those are historical findings, not assertions that the defects remain today. The follow-up history contains production-consumer fixes (`1154599`, `6ea9a5b`), a shared report renderer (`9be4f70`) and live-renderer disclosure verification (`6ba2474`).

Today's checks therefore exercise the actual catalog's search, category filters, print overview, priority order and time-dependent labels, in addition to the data transformer. The EEC title correction also preserves its old public link.

**Engineering lesson:** verify the complete claim where the reader sees it: source → data → screen → report/export → next action. Test counts and helper coverage alone cannot establish that the feature is wired into the product.

## 5. More features are not yet evidence of greater impact

The period added preparation packets, local-support discovery, permit exhibits, a grants workspace, learning flows and an extension. Release history supports that substantial implementation occurred. It does not prove that more businesses received funding or that the product reduced the time to a useful next step.

The [analytics definitions](../analytics-notes.md) correctly describe contact clicks as an impact proxy and requests as recorded rather than delivered or acknowledged. The checked-in [five-case scorecard](../practitioner-validation-scorecard.csv) still contains “Not observed” rows. That means the repository does not contain completed results; it does not establish that no sessions occurred elsewhere. No production 90-day analytics query or new interviews were performed for this retrospective.

**What remains unproven:** acquisition and activation trends, whether users understand the reports without help, the quality of organization matches, confirmed connections, completed applications and funding outcomes.

## Recommended next learning cycle

Use the existing [five-case practitioner sprint](../practitioner-validation-sprint.md): equipment, remodel, expansion/hiring, property acquisition and multifamily. Its decision thresholds are already concrete: four of five generate a report without rescue, four of five explain a next step, at least three prepare or take a useful action, and no material eligibility, funding or handoff misconception persists.

Pair those observations with a dated 90-day product-event readout. Keep report activity, recorded requests, acknowledged connections and funding outcomes separate. Review where the funnel loses people before deciding which new surface to build. This is a recommendation, not a scheduled automation, completed study or outreach authorization.

For program operations, prioritize near-term windows and every card with unresolved intake. The audit's date handling and classification corrections are included in the release Billy authorized on October 9; its deployment evidence belongs in the audit report. Remaining source gaps are named in the ledger. Future releases should preserve the distinction between corrected locally, published and verified on the live site.
