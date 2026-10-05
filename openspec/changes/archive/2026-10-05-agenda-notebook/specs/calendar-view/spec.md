# calendar-view Specification

## Purpose

Month calendar placing every dated record by its `date`.

## Requirements

### Requirement: Month grid

The calendar MUST render a month grid and place every record on the day matching its `date`. Records without a date (undated notes) MUST be excluded from the grid and remain reachable from the list.

#### Scenario: Dated record placed

- GIVEN a record dated 2026-10-15
- WHEN the October calendar renders
- THEN it appears on the 15th

#### Scenario: Undated note excluded

- GIVEN an undated note
- WHEN the calendar renders
- THEN it does not appear on any day

### Requirement: Month navigation

The calendar MUST allow moving to the previous and next month and back to the current month; the displayed month MUST be reflected in the view.

#### Scenario: Navigate

- GIVEN the October calendar
- WHEN the user goes to the next month
- THEN November renders with its records

### Requirement: Day selection

Selecting a day MUST show that day's records and offer a way to enter a new record for that date.

#### Scenario: Day detail

- GIVEN a day with records
- WHEN the user clicks it
- THEN that day's records and a create entry point show

### Requirement: Calendar UI states

The calendar MUST render loading, empty, and error states distinctly with Spanish copy consistent with the existing app.

#### Scenario: Empty month

- GIVEN a month with no dated records
- WHEN the calendar renders
- THEN an empty Spanish message shows
