# Delta for record-visibility

## ADDED Requirements

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
