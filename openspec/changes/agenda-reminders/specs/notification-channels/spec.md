# notification-channels Specification

## Purpose

Define the seam between reminder scheduling and concrete providers, so Telegram today — and any other provider later — plug in without touching scheduling logic.

## Requirements

### Requirement: Channel contract

The system MUST define a notification channel contract that accepts a target and a message and reports exactly one outcome: delivered, transient failure, or blocked (the recipient rejected the bot). Telegram MUST be provided as one implementation of the contract.

#### Scenario: Delivered outcome

- GIVEN a channel implementation
- WHEN the provider accepts the message
- THEN the channel reports delivered

#### Scenario: Blocked outcome

- GIVEN a provider rejection because the recipient blocked the bot
- WHEN the outcome is reported
- THEN the channel reports blocked, not delivered

### Requirement: Scheduler depends only on the interface

The reminder scheduler MUST depend only on the channel contract and MUST NOT contain provider-specific calls; no Telegram (or other provider) API access is permitted inside the scheduler.

#### Scenario: No provider coupling

- GIVEN the reminder scheduler
- WHEN its dependency surface is inspected
- THEN only the channel contract is referenced

### Requirement: Seam proven with a fake channel

The scheduler MUST be verifiable by a unit test that substitutes an in-memory fake channel. A real provider, credentials, and network access MUST NOT be required to test scheduling, eligibility, or notified marking.

#### Scenario: Scheduler tested against a fake

- GIVEN a fake channel recording sends
- WHEN due records are processed by the scheduler
- THEN the fake records exactly the expected sends and the test passes with no network or credentials involved

### Requirement: Additional channels are additive

A new channel implementation MUST be addable by implementing the contract alone; eligibility and scheduling rules MUST NOT change when it is selected. WhatsApp Cloud API is out of scope for this change — only the seam exists.

#### Scenario: New provider added later

- GIVEN a second channel implementation selected by configuration
- WHEN due records are processed
- THEN eligibility and cadence behave exactly as before
