# Delta for task-listing

## ADDED Requirements

### Requirement: Telegram linking entry point

The list view MUST expose an entry point to the Telegram linking/status page, mirroring the existing calendar entry point. The entry MUST be available regardless of current link state so a user can link, check status, or re-link from the list.

#### Scenario: Open linking page

- GIVEN the list view
- WHEN the user activates the Telegram entry
- THEN the linking/status page opens

#### Scenario: Entry present when unlinked

- GIVEN a user with no Telegram link
- WHEN the list view renders
- THEN the Telegram entry is shown and opens the linking page

#### Scenario: Entry shows current status

- GIVEN a linked user
- WHEN the list view renders
- THEN the Telegram entry reflects the linked status and still opens the linking page
