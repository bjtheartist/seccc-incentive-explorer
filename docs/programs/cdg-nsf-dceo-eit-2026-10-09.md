# CDG priority, NSF and DCEO EIT program discovery

Scope: Billy's October 9 request and supplied DCEO EIT screenshot (`IMG_4375.PNG`). The screenshot supersedes the earlier state-audit backlog as the requested list. No corresponding funding issue was found in the Chicago Incentive Explorer Linear project.

## Acceptance criteria

- CDG Small, Medium and Large lead `/programs`. NSF is included lower in the directory.
- Small CDG leads the eight discovery recommendations in location and development reports only when both mapped TIF/SBIF and NOF coverage are explicitly false. TIF remains the existing SBIF geography proxy. Unknown coverage does not trigger the fallback. Priority does not establish eligibility.
- All 15 current resources from the screenshot have individual State cards and generated explainer pages. Keyword and industry filters can surface them.
- Loans, equity, tax credits, grants and advisory services have distinct labels.
- The three historical resources remain discoverable through the inactive/expired toggle, with no active report recommendations.
- CDG Small and Medium use the current February 16, 2027 application links and deadlines. The grant cap is not described as the total-project-cost cap.

## Source reconciliation

Official pages read October 9, 2026. Program-specific eligibility and intake remain subject to administrator review. Suggested preparation steps are not a certification of complete application requirements.

| Screenshot resource | Catalog ID | Official source / treatment |
| --- | --- | --- |
| INVENT | `illinoisInvent` | [DCEO](https://dceo.illinois.gov/illinoisinvent.html); equity, not a grant |
| Advantage Illinois | `advantageIllinois` | [DCEO](https://dceo.illinois.gov/smallbizassistance/advantageillinois.html); lender-delivered credit support |
| Climate Bank Finance | `illinoisClimateBank` | [Climate Bank](https://www.illinoisclimatebank.com/financing-programs/developers-contractors/state-small-business-credit-initiative-ssbci/); rates refer to its loan portion |
| Angel Investment | `angelInvestmentCredit` | [DCEO](https://dceo.illinois.gov/expandrelocate/incentives/taxassistance/angelinvestment.html); 25%, or 35% for designated set-asides; investor credit |
| New Markets Development | `illinoisNewMarkets` | [DCEO](https://dceo.illinois.gov/expandrelocate/incentives/new-markets.html); all allocation rounds closed |
| SBIR/STTR state match | `illinoisSbirMatch` | [DCEO](https://dceo.illinois.gov/whyillinois/sbir-sttr-phase1.html); current Phase I/II limits replace screenshot's older $50,000 figure |
| Innovation Vouchers | `innovationVoucher` | [State-linked administrator](https://ilinnovoucher.istcoalition.org/); existing card refreshed |
| SBDCs | `illinoisSbdc` | [DCEO](https://dceo.illinois.gov/smallbizassistance/beginhere/sbdc.html) |
| ITCs | `illinoisItc` | [DCEO](https://dceo.illinois.gov/smallbizassistance/beginhere/itc.html) |
| APEX | `illinoisApex` | [DCEO](https://dceo.illinois.gov/smallbizassistance/beginhere/ptac.html) |
| Clean Energy Incubators | `cejaIncubator` | [DCEO](https://dceo.illinois.gov/ceja/ceja-contractor-programs.html); provider intake needs confirmation |
| Clean Energy Accelerators | `cejaAccelerator` | [DCEO](https://dceo.illinois.gov/ceja/ceja-contractor-programs.html); current program name and coaching model |
| First Stop BIC | `firstStopBic` | [DCEO](https://dceo.illinois.gov/smallbizassistance/beginhere/businessinformationcenter.html) |
| Regulatory Flexibility | `regulatoryFlexibility` | [DCEO](https://dceo.illinois.gov/smallbizassistance/lawsregsandpermitting.html) |
| SBEAP | `illinoisSbeap` | [DCEO](https://dceo.illinois.gov/smallbizassistance/environmentalassistanceprogram.html) |
| Wet Lab Capital | `illinoisWetLab` | Inactive label from supplied guide; [DCEO EIT](https://dceo.illinois.gov/aboutdceo/entrepreneurshipinnovationtechnology.html) describes past awards; current intake unverified |
| Legacy IIVF | `illinoisIivf` | Supplied guide's inactive SSBCI 1.0 listing; distinct from INVENT; current intake unverified |
| ISBEL | `illinoisEmergencyLoan` | [DCEO](https://dceo.illinois.gov/smallbizassistance/illinoissmallbusinessemergencyloanfund.html) says no additional loans; original program excluded Chicago |

[NSF](https://seedfund.nsf.gov/) is a federal deep-technology research program. Its [eligibility and pitch process](https://seedfund.nsf.gov/apply/get-started/) and [invited proposal deadlines](https://seedfund.nsf.gov/apply/full-proposal/) are linked separately. The Illinois match requires a qualifying federal award first.

The [DPD application directory](https://cocdpd.submittable.com/submit) verifies the Small and Medium CDG deadlines and application destinations. Chicago's CDG landing page/manual returned access errors in this run; inherited detailed documentation requirements were not comprehensively re-audited. Unsupported blanket stacking claims on Small and Medium were removed. Legacy federal SSBCI overview ID and name remain intact to preserve existing links; separate State cards provide actionable program entries.

## Boundaries

No zone geometries, external applications, database seeds, unrelated state-audit programs or messages changed. Existing report limits remain; the complete resource set is discoverable under Programs. Historical IIVF and Wet Lab intake is explicitly unverified, with no fresh verification date claimed.

## Release integration and verification

Billy authorized push and publication after reviewing the local preview. The preview checkout was an older rescue branch. This release carries the requested change onto current `origin/main` (`cd0ec24`) while preserving the already-live protected CTC research release (`9d54cb4`). The ignored private HTML is copied unchanged from that release checkout and is included only in the Vercel upload, never Git. See `docs/ctc-research-publication.md` for that existing packaging requirement.

The current application's sole source of truth is `data/programs-internal.json`; the sanitized `public/data/programs-public.json` is regenerated with the existing exporter. The catalog grows from 71 to 89 records. Only editorial industry/type tags and the inactive flag are added to the public projection. No raw internal catalog is reintroduced into client bundles. Unverified intake remains explicitly unknown; a listing is not a claim that a funding round is open.

305 tests across 17 focused suites pass, including the actual catalog's order/search/State/industry/inactive interactions, both report paths, public projection and schema preservation, report safety and the protected research route. TypeScript, touched-file ESLint, public-artifact drift check and `git diff --check` pass. Earlier preview checks also passed; those ran against the older implementation and are not the release acceptance evidence.

The CDG public window includes the full Chicago closing day. Report intake text now accepts that exact timestamp, with a test before and after the cutoff. The Spanish Small CDG portal remains available; DPD lists it separately without the new English deadline in its title.

No matching Linear funding issue was found; acceptance criteria come directly from Billy's request and supplied screenshot. No migrations, new environment variables or follow-up issues are required by this change.
