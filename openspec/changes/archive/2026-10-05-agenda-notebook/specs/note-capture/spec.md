# note-capture Specification

## Purpose

Capture dated/undated rich-text notes as first-class records, searchable by keyword.

## Requirements

### Requirement: Note creation

A note MUST be a record of type `note`, coexisting with `task`|`request`, owned by the creator, with an optional title (assumption: optional) and a rich-text body. Its `date` (`YYYY-MM-DD`) MUST be optional. An undated note MUST still be stored and listed.

#### Scenario: Dated note

- GIVEN an authenticated user
- WHEN a note with a future date is saved
- THEN it is stored as theirs and is eligible for calendar placement

#### Scenario: Undated note

- GIVEN an authenticated user
- WHEN a note without a date is saved
- THEN it is stored and listed, and excluded from the calendar

### Requirement: Rich-text body and sanitization

The note body MUST be authored as rich text, stored as HTML/JSON, and rendered sanitized so `<script>` tags and inline event handlers (`onerror`, etc.) are stripped. Malicious markup MUST NOT execute on render.

#### Scenario: Formatting round-trip

- GIVEN a note with bold/list/heading formatting
- WHEN it is saved and reopened
- THEN the formatted content renders equivalently

#### Scenario: XSS stripped

- GIVEN a note body containing `<script>` or an `onerror` attribute
- WHEN it is rendered
- THEN the script/handler is stripped and nothing executes

### Requirement: Plain-text search index

The system MUST derive a plain-text representation of the note body and feed it into the existing fulltext `searchText`, so note text is findable by keyword.

#### Scenario: Note found by keyword

- GIVEN A's note body contains "reunión"
- WHEN A searches that keyword
- THEN the note is returned

### Requirement: Creation timestamp display

A note MUST surface its `createdAt` in Spanish copy consistent with the app ("Anotado el …").

#### Scenario: Timestamp shown

- GIVEN a saved note
- WHEN it is displayed
- THEN its creation date is shown in Spanish

### Requirement: Note UI states

Note create/display MUST render loading, empty, and error states distinctly, with Spanish copy consistent with the existing app.

#### Scenario: Error

- GIVEN a failed save or load
- WHEN the note form/view renders
- THEN an error state with retry shows in Spanish
