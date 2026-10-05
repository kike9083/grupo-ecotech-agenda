# task-listing Specification

## Purpose

List view: sorting, states, attribution.

## Requirements

### Requirement: Default listing

The list MUST show the caller's records (admins: all), including notes, date+time descending, paginated. Records without a date MUST still appear, ordered by creation time descending.
(Previously: covered tasks/requests only and did not define ordering for undated records.)

#### Scenario: Sort

- GIVEN records 2026-10-01 09:00 and 2026-10-02 08:00 WHEN list opens THEN later shows first

#### Scenario: Undated note listed

- GIVEN an undated note WHEN the list opens THEN it appears ordered by its creation time

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

### Requirement: Calendar entry point

The list view MUST expose an entry point to the calendar view.

#### Scenario: Open calendar

- GIVEN the list view
- WHEN the user activates the calendar entry
- THEN the calendar view opens

### Requirement: Creation timestamp display

Each listed record MUST display its `createdAt` in Spanish copy consistent with the app: tasks and requests as "Creada el …", notes as "Anotado el …". Every record type shows its creation timestamp; note rows must not show the task label and vice versa.

#### Scenario: Timestamp

- GIVEN a listed record of any type (task, request, or note)
- WHEN it renders
- THEN its creation timestamp shows with the type-appropriate Spanish label
