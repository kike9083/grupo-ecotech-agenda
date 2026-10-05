# attachments Specification

## Purpose

Files (images, voice notes) attached to any record via a generic `recordId`.

## Requirements

### Requirement: Attachment upload

Records MAY carry multiple attachments keyed by a generic `recordId`. Uploads MUST accept images (`image/jpeg`, `image/png`, `image/webp`, `image/heic`) and audio (`audio/webm`, `audio/mpeg`|mp3, `audio/wav`, `audio/ogg`, `audio/mp4`|m4a, `audio/aac`); other types MUST be rejected. Each file MUST be capped at 30 MB, defined exactly as 30,000,000 bytes — the same value provisioned as the storage bucket's `maximumFileSize` and used to derive the Spanish size-limit copy (superseding design D3's earlier 30 MiB / 31,457,280 figure). Upload MUST be initiated from the owning record's form, and an unauthenticated upload MUST be rejected with a session error and store nothing.

#### Scenario: Multiple valid files

- GIVEN a record form
- WHEN a user attaches several valid image/audio files, including files between 10 MB and 30 MB
- THEN all are stored under that record's `recordId`

#### Scenario: Oversized or wrong type

- GIVEN a file over 30 MB (30,000,000 bytes) or an unsupported type
- WHEN upload is attempted
- THEN it is rejected with HTTP 400 and an inline Spanish error (`El archivo es demasiado grande (máximo 30 MB).` for oversized, `Tipo de archivo no soportado.` for unsupported type) and nothing is stored

### Requirement: Upload failure handling

A failed upload MUST NOT corrupt the record or lose already-stored attachments; the user MUST see a retryable Spanish error.

#### Scenario: Network failure

- GIVEN a valid file
- WHEN the storage call fails
- THEN the record keeps prior attachments and an error with retry shows

### Requirement: Attachment display

Images MUST render in a gallery and audio in a playable player. Each attachment MUST be served through an authenticated server-side route that streams the stored file after a session and permission check; a public bucket URL MUST NOT be exposed to the browser.

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
