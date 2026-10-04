# Delta for task-listing

## ADDED Requirements

### Requirement: Calendar entry point

The list view MUST expose an entry point to the calendar view.

#### Scenario: Open calendar

- GIVEN the list view
- WHEN the user activates the calendar entry
- THEN the calendar view opens

### Requirement: Creation timestamp display

Each listed record SHOULD display its `createdAt` in Spanish copy consistent with the app.

#### Scenario: Timestamp

- GIVEN a listed record
- WHEN it renders
- THEN its creation timestamp shows

## MODIFIED Requirements

### Requirement: Default listing

The list MUST show the caller's records (admins: all), including notes, date+time descending, paginated. Records without a date MUST still appear, ordered by creation time descending.
(Previously: covered tasks/requests only and did not define ordering for undated records.)

#### Scenario: Sort

- GIVEN records 2026-10-01 09:00 and 2026-10-02 08:00 WHEN list opens THEN later shows first

#### Scenario: Undated note listed

- GIVEN an undated note WHEN the list opens THEN it appears ordered by its creation time
