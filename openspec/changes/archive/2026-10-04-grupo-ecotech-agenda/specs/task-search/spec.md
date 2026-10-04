# task-search Specification

## Purpose

Keyword lookup via fulltext index.

## Requirements

### Requirement: Keyword search

One keyword box MUST match title AND description via the fulltext index, scoped to caller visibility (own; all for admins); empty query returns the unfiltered list.

#### Scenario: User search

- GIVEN A's records contain "pago" WHEN A searches THEN only A's matches show

#### Scenario: Admin search

- GIVEN matches across users WHEN admin searches THEN all users' matches show

#### Scenario: No match

- GIVEN no visible matches WHEN results render THEN the empty state shows
