# telegram-linking Specification

## Purpose

Bind a user's Telegram chat to their account through a one-time expiring token exchange, and expose link status/unlink.

## Assumptions (pending user confirmation)

- After a "bot blocked by user" (Telegram 403), re-linking is manual; there is no email or other fallback channel. (Proposal question 4 — confirm to lock.) Not overridden by the user as of the archive (2026-10-05) — still an assumption, not a settled requirement.

## Requirements

### Requirement: Link initiation

An authenticated user MUST be able to request a Telegram link and receive a one-time token with a 10-minute expiry, presented as a deep link that opens the bot carrying that token. Requesting a new link MUST invalidate the previously minted unused token, so only the latest deep link can be exchanged.

#### Scenario: Mint link

- GIVEN a logged-in user, possibly still holding an older unused token
- WHEN they request a Telegram link
- THEN a deep link to the bot with a single-use token shows and any previously minted token is invalidated

#### Scenario: Expired token rejected

- GIVEN a token minted 10 minutes earlier and never used
- WHEN the bot submits it
- THEN it is rejected and the user can mint a fresh one

### Requirement: Bot callback validation

The bot callback (`POST /api/telegram/link`) MUST be excluded from the session middleware matcher so it is reachable without a session cookie; the route self-authenticates. It MUST accept an exchange only when the `x-link-secret` header matches the configured secret (length-guarded, timing-safe compare) AND the token exists, is unexpired, and is unused. On success it stores the chat id as the user's link, consumes the token, and the bot confirms in the chat. Link tokens, chat ids, and the bot token MUST NOT be logged.

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
- THEN the route rejects it and nothing is stored, regardless of token validity — the rejection comes from the route itself (the matcher excludes it), not from a redirect to the login page

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

## Implementation Notes (as shipped, agenda-reminders, archived 2026-10-05)

Non-normative; reconciled with the verified implementation.

- Middleware exclusion: `api/telegram/link` is in the `MIDDLEWARE_MATCHER` literal of both `src/lib/middleware-matcher.ts` and `src/middleware.ts` (literal-sync test guards the pair). Live-proven: `POST` without/with a wrong `x-link-secret` returns the route's `401 {"error":"unauthorized"}` (not a `307` to `/login`); `GET` returns `405` — the route was reached.
- Secret header: `x-link-secret` compared with length-guarded `crypto.timingSafeEqual` → `401` without touching storage.
- Re-mint overwrites the stored token in the user's subscription document, killing older deep links — observed live during the E2E run.
- Unknown / expired / consumed tokens get a uniform `404` (no oracle). Bot token and link secret live only in env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_LINK_SECRET`) and are never written to any SDD artifact or log.
