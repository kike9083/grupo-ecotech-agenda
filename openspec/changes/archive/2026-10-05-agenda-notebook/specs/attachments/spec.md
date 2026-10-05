# attachments Specification

## Purpose

Files (images, voice notes) attached to any record via a generic `recordId`.

## Requirements

### Requirement: Attachment upload

Records MAY carry multiple attachments keyed by a generic `recordId`. Uploads MUST accept images (`image/jpeg`, `image/png`, `image/webp`, `image/heic`) and audio (`audio/webm`, `audio/mpeg`|mp3, `audio/wav`, `audio/ogg`, `audio/mp4`|m4a, `audio/aac`); other types MUST be rejected. Each file MUST be capped at 30 MB (default). Upload MUST be initiated from the owning record's form.

#### Scenario: Multiple valid files

- GIVEN a record form
- WHEN a user attaches several valid image/audio files
- THEN all are stored under that record's `recordId`

#### Scenario: Oversized or wrong type

- GIVEN a file over 30 MB or an unsupported type
- WHEN upload is attempted
- THEN it is rejected with an inline Spanish error and nothing is stored

### Requirement: Upload failure handling

A failed upload MUST NOT corrupt the record or lose already-stored attachments; the user MUST see a retryable Spanish error.

#### Scenario: Network failure

- GIVEN a valid file
- WHEN the storage call fails
- THEN the record keeps prior attachments and an error with retry shows

### Requirement: Attachment display

Images MUST render in a gallery and audio in a playable player. Each attachment MUST be served via a server-issued signed URL, never a public URL.

#### Scenario: Gallery and player

- GIVEN a record with one image and one voice note
- WHEN it is displayed
- THEN the image shows in the gallery and the audio in a player

### Requirement: Attachment deletion

Deleting an attachment MUST remove both the stored file and its `attachments` metadata.

#### Scenario: Delete

- GIVEN a record with an attachment
- WHEN the owner deletes it
- THEN the file and its metadata are gone and the gallery/player updates

### Requirement: Attachment visibility

Attachment access MUST mirror the parent record's permissions: creator-only reads/writes, admins via the existing collection-level `read("team:admins")` grant. No separate permission model SHALL be introduced.

#### Scenario: Peer isolation

- GIVEN B requests an attachment on A's record
- WHEN B is not an admin
- THEN B gets none of A's file data

#### Scenario: Admin read

- GIVEN an admin
- WHEN the admin views a record
- THEN its attachments are readable
