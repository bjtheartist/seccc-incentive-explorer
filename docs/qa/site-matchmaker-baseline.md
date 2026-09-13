# Frozen baseline: September 13, 2026

Production revision: `9dbbde67231f9042cbb7eaf465aab7ca0479a7ae`. Original audit output remains locally under `output/qa-south-chicago`; this summary preserves the release-relevant observations.

- ZIP 60617 held 3,726 records; only 2,042 map points were inside the official South Chicago community polygon. A ZIP is not a neighborhood.
- Every one of the 4,688 building-evidence rows across nine ZIPs lacked raw building-area input. County assessor measurements existed separately, after ranking, so a size filter could eliminate all buildings.
- The original deterministic sample comprised 15 building and 15 land records inside South Chicago: 30/30 point zoning checks agreed, 26 resolved PINs contained their map points, four identities remained unresolved. This was diagnostic, not a representative citywide sample.
- Commercial searches admitted recorded houses at 9513 S Oglesby and 10802 S Torrence, and apartments at 8100 S Brandon, 8158 S South Shore and 3019 E 83rd. Housing searches admitted the commercial building at 3100 E 92nd. Broad zoning alignment did not prevent either error.
- Class 212 and 318 represent mixed use; do not count these as residential-only errors.
- 8408 S Burley and 9139 S Buffalo were land records with conflicting County building evidence. Assessment-year 2024 facts do not prove present conditions.
- There were 125 effective duplicate-PIN groups in ZIP 60617. Same-PIN aliases or units require separate treatment from exact duplicate leads.
- Rail radii used rounded 400/800/1600-meter limits. Exact-code map/card filters did not narrow the full-shortlist CSV.
- Bus, expressway, context, walkability and amenity choices were not hard filters.

See [approved action plan](site-matchmaker-accuracy-plan.md) and [implementation evidence](site-matchmaker-accuracy-progress.md). Original sample and targeted cases are excluded from the new 90-record holdout.
