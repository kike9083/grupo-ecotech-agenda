# record-visibility Specification

## Purpose

Per-user visibility; admins see all.

## Requirements

### Requirement: Own records only

Each user MUST see only their own records, enforced server-side via document permissions (creator `user:<uid>` r/w + `team:admins` read) and server queries; others' records MUST NOT be readable or writable.

#### Scenario: Peer isolation

- GIVEN A's records WHEN B requests A's document THEN B gets none of A's data

#### Scenario: Owner write

- GIVEN A's record WHEN A edits it THEN the change saves

#### Scenario: Admin read

- GIVEN records from several users WHEN an admin lists THEN all show
