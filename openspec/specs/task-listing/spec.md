# task-listing Specification

## Purpose

List view: sorting, states, attribution.

## Requirements

### Requirement: Default listing

The list MUST show the caller's records (admins: all), date+time descending, paginated.

#### Scenario: Sort

- GIVEN records 2026-10-01 09:00 and 2026-10-02 08:00 WHEN list opens THEN later shows first

### Requirement: UI states

Loading, empty (no records/results), and error (failed query, retry) states MUST render distinctly.

#### Scenario: Loading or empty

- GIVEN a query in flight or zero visible records WHEN the list renders THEN the loading or empty state shows

#### Scenario: Error

- GIVEN a failed query WHEN the list renders THEN an error with retry shows

### Requirement: Admin view attribution

Admins MUST get a minimal all-records view indicating each record's creator.

#### Scenario: Attribution

- GIVEN A's and B's records WHEN an admin opens the list THEN each shows its creator
