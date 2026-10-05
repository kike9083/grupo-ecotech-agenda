# Delta for task-registration

## ADDED Requirements

### Requirement: Task attachments

A task MAY carry attachments (images, voice notes) keyed by its record id; attachment behavior is defined by the `attachments` capability. Existing task creation and validation MUST remain unchanged when no attachment is present.

#### Scenario: Task with attachment

- GIVEN an authenticated user
- WHEN a valid task is saved with an image
- THEN the task is stored and the image is listed among its attachments

#### Scenario: Task without attachment

- GIVEN an authenticated user
- WHEN a valid task is saved with no files
- THEN it is stored exactly as before
