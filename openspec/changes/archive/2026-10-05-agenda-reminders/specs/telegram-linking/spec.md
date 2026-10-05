# telegram-linking Specification

## Purpose

Bind a user's Telegram chat to their account through a one-time expiring token exchange, and expose link status/unlink.

## Assumptions (pending user confirmation)

- After a "bot blocked by user" (Telegram 403), re-linking is manual; there is no email or other fallback channel. (Proposal question 4 — confirm to lock.)

## Requirements

### Requirement: Link initiation

An authenticated user MUST be able to request a Telegram link and receive a one-time token with a 10-minute expiry, presented as a deep link that opens the bot carrying that token.

#### Scenario: Mint link

- GIVEN a logged-in user
- WHEN they request a Telegram link
- THEN a deep link to the bot with a single-use token shows

#### Scenario: Expired token rejected

- GIVEN a token minted 10 minutes earlier and never used
- WHEN the bot submits it
- THEN it is rejected and the user can mint a fresh one

### Requirement: Bot callback validation

The bot callback MUST accept an exchange only when the shared-secret header matches the configured secret AND the token exists, is unexpired, and is unused. On success it stores the chat id as the user's link, consumes the token, and the bot confirms in the chat. Link tokens, chat ids, and the bot token MUST NOT be logged.

#### Scenario: Successful exchange

- GIVEN an unused, unexpired token and a valid secret header
- WHEN the bot posts the token together with the chat id
- THEN the chat is stored as the user's link, the token is consumed, and a confirmation arrives in the chat

#### Scenario: Reused token rejected

- GIVEN a token already exchanged
- WHEN the callback posts it again
- THEN it is rejected and the stored link is unchanged

#### Scenario: Missing secret header rejected

- GIVEN a callback without the shared-secret header
- WHEN it posts
- THEN it is rejected and nothing is stored, regardless of token validity

### Requirement: Link status and unlink

The linking page MUST show the current user's link status and MUST offer an unlink action that removes the chat binding; while unlinked, no reminders are sent to that user.

#### Scenario: Status shown

- GIVEN a linked user
- WHEN they open the linking page
- THEN linked status shows

#### Scenario: Unlink

- GIVEN a linked user
- WHEN they unlink
- THEN the binding is removed and the page shows unlinked

### Requirement: Deactivated subscription on block

When a send is rejected because the user blocked the bot (Telegram 403), the subscription MUST be deactivated, no further sends are attempted for that user, and the linking page MUST show a re-link prompt. Recovery is manual re-link only (see Assumptions).

#### Scenario: Blocked bot deactivates

- GIVEN a linked user who blocked the bot
- WHEN a reminder send returns 403
- THEN the subscription deactivates and the page shows a re-link prompt

#### Scenario: Re-link restores delivery

- GIVEN a deactivated subscription
- WHEN the user completes the token exchange again
- THEN the link is active again and reminders resume
