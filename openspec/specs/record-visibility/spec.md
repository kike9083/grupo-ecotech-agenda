# record-visibility Specification

## Purpose

Per-user visibility; admins see all.

## Requirements

### Requirement: Own records only

Each user MUST see only their own records, enforced server-side via per-document creator grants (`read("user:<uid>")` / `write("user:<uid>")`), a collection-level admin read grant (`read("team:admins")`), and server queries; others' records MUST NOT be readable or writable.

#### Scenario: Peer isolation

- GIVEN A's records WHEN B requests A's document THEN B gets none of A's data

#### Scenario: Owner write

- GIVEN A's record WHEN A edits it THEN the change saves

#### Scenario: Admin read

- GIVEN records from several users WHEN an admin lists THEN all show

### Requirement: Notification isolation

A reminder MUST be delivered only to the record's creator. Another user, a peer, or an admin reading, listing, or searching someone else's record MUST NOT trigger any notification — for the viewer, the record owner, or anyone else. Viewing a record MUST NOT generate sends; only the reminder scheduler produces notifications, and only for records the recipient created.

#### Scenario: Only creator notified

- GIVEN A's due record and A's linked chat
- WHEN the reminder scheduler runs
- THEN only A is notified

#### Scenario: Admin read notifies no one

- GIVEN an admin reading B's record
- WHEN the admin opens, reads, and closes it
- THEN no notification is sent to the admin, to B, or to any other user

#### Scenario: Peer view notifies no one

- GIVEN B viewing their own list while A has a due record
- WHEN B reads records around the time A's reminder becomes due
- THEN B receives nothing and only A can be notified by the scheduler

#### Scenario: Search and calendar notify no one

- GIVEN any user searching or browsing the calendar
- WHEN they view records they are permitted to see
- THEN no notification is produced for that viewing activity
