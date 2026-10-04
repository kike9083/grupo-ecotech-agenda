# task-registration Specification

## Purpose

Create/update records owned by the creator.

## Requirements

### Requirement: Record creation

Records MUST have title, description, date (YYYY-MM-DD), time (HH:mm), type (`task`|`request`), status (default `open`), owner = authenticated user. Dates: strings, America/Panama, past allowed (backfill), no conversion. No delegation.

#### Scenario: Register

- GIVEN a user WHEN valid data is submitted THEN it is stored as theirs

#### Scenario: Backfill

- GIVEN an authenticated user WHEN a past date is submitted THEN it stores unchanged

### Requirement: Form validation

Non-empty title, valid date/time, and type MUST be present; invalid input MUST block submit with an inline error and create nothing.

#### Scenario: Invalid input

- GIVEN empty title or malformed date/time WHEN submit is attempted THEN it is blocked with an inline error, no record created

### Requirement: Status lifecycle

Status MUST go `open` → `in_progress` → `done`, or `cancelled` from any non-terminal state. Owner updates own status; admins any record; no history.

#### Scenario: Owner advances

- GIVEN the owner's `open` record WHEN status changes to `in_progress` THEN it saves

#### Scenario: Admin overrides

- GIVEN another user's record WHEN an admin sets `cancelled` THEN it saves
