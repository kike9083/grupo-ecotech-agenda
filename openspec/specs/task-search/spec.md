# task-search Specification

## Purpose

Keyword and date-range lookup via fulltext index.

## Requirements

### Requirement: Keyword search

One keyword box MUST match title, description, and note plain text via the fulltext index, scoped to caller visibility (own; all for admins). An optional inclusive date range (`from`/`to`, `YYYY-MM-DD`) MUST combine with the keyword, so both filters apply together. An empty keyword with no range returns the unfiltered list.
(Previously: keyword-only, no date range, and did not cover note text.)

#### Scenario: User search

- GIVEN A's records contain "pago" WHEN A searches THEN only A's matches show

#### Scenario: Admin search

- GIVEN matches across users WHEN admin searches THEN all users' matches show

#### Scenario: Date range

- GIVEN records across October WHEN the user sets from=2026-10-01 to=2026-10-15 THEN only records dated within the inclusive bounds show

#### Scenario: Keyword plus range

- GIVEN matching records inside and outside the range WHEN both q and range are set THEN only matches within the range show

#### Scenario: Invalid range

- GIVEN from is after to WHEN the user submits THEN the filter is rejected with an inline Spanish error and no query runs

#### Scenario: No match

- GIVEN no visible matches WHEN results render THEN the empty state shows
