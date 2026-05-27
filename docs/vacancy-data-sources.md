# Vacancy Data Sources

The vacancy layer intentionally separates stronger vacancy records from softer local condition signals.

## Current Sources

- City-Owned Land Inventory (`cols`): city-owned vacant land from Chicago Open Data.
- 311 Vacant/Abandoned Building Complaint (`dpd_vacant`): reported vacant buildings from Chicago 311 service requests, pulled with a rolling 3-year window.
- 311 Clean Vacant Lot Request (`311_clean_lot`): reported vacant-lot maintenance signals from Chicago 311 service requests, pulled with a rolling 5-year window because lot conditions can persist but should be treated as softer evidence.

## Product Labels

- `vacant_land`: City-Owned Vacant Land
- `vacant_building`: Vacant Building
- `reported_vacant_lot`: Reported Vacant Lot Signal

`reported_vacant_lot` should not be described as a confirmed vacant property. It is a useful public-data signal that a lot may be vacant or unmanaged, but it should be locally verified before outreach, acquisition, or program guidance.

## Why This Exists

Some visible neighborhood vacancies do not appear in the City-Owned Land Inventory or the 311 Vacant/Abandoned Building Complaint feed. The Morse and Glenwood Rogers Park check surfaced this gap: the immediate corner had no records in the two original vacancy sources, but did have nearby 311 Clean Vacant Lot Requests and other property-condition signals.
