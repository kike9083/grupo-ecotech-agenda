# agenda-auth Specification

## Purpose

Server-side authentication and admin-role detection.

## Requirements

### Requirement: Server-side session

Auth MUST use email/password with a server-managed HTTP-only cookie; the browser MUST NOT call Appwrite.

#### Scenario: Login

- GIVEN valid credentials WHEN submitted THEN a session cookie is set

#### Scenario: Bad credentials

- GIVEN wrong credentials WHEN submitted THEN an error shows, no session exists

#### Scenario: No session

- GIVEN no session WHEN an agenda page is opened THEN redirect to login

### Requirement: Admin role detection

A user MUST be admin iff they belong to Appwrite team `admins` (owner admin@grupoecotech.com).

#### Scenario: Detection

- GIVEN a user WHEN page data builds THEN flag = iff in `admins`
