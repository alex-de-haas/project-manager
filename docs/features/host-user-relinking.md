# Host User Email Relinking

Created: 2026-06-11
Updated: 2026-06-12

## Overview

Project Manager preserves existing local user data when Hosty regenerates Host user IDs but keeps trusted user email addresses stable. When a new Hosty user ID arrives with an email that uniquely matches an existing local user, Project Manager updates that existing local user instead of creating a duplicate.

The local `users.id` remains stable, so project membership, Azure DevOps PAT credentials, provider identities, time entries, days off, releases, and assigned work remain attached to the same person.

## User Resolution

Project Manager resolves Hosty-backed users in two paths:

- `ensureHostUser()` runs when a request has a trusted Hosty identity.
- `upsertHostDirectoryUsers()` runs when Project Manager synchronizes the Hosty scoped app directory.

Both paths first look up the user by `users.host_user_id`. If a local user already has the incoming Hosty ID, Project Manager updates Hosty-derived fields and returns that existing local user.

If no local user has the incoming Hosty ID, Project Manager normalizes the trusted email with trim and lowercase rules and searches existing users by `lower(trim(email))`. Email relinking runs only when exactly one local user matches that normalized email.

## Relink Behavior

When exactly one local user matches the trusted normalized email, Project Manager updates that row with:

- The new `host_user_id`.
- The Hosty-derived unique local `name`.
- The Hosty email.
- The resolved Host administrator flag.
- The `updated_at` timestamp.

Project Manager keeps the existing local user id. If `app_display_name` is missing, it is initialized from the resolved Hosty display name; existing app display names are preserved.

The relink is global to the local user record. It is not scoped to a Project Manager project or to a specific integration provider.

## Fallback Behavior

Project Manager creates a new local user when no existing user matches the incoming Hosty ID and either:

- The trusted Hosty identity has no email.
- No local user matches the trusted normalized email.
- More than one local user matches the trusted normalized email.

Project Manager does not automatically merge already-created duplicate local users. Duplicate repair remains a manual database operation.

## Data Model

Relinking uses the existing `users` table. The internal integer `users.id` remains unchanged.

The database includes `idx_users_normalized_email` on `lower(trim(email))` so login-time user resolution and Hosty directory synchronization can find unique email matches efficiently.

## Operational Impact

After relinking, the user continues to see data attached to the existing local user record, including project access, time entries, days off, assigned work, release planning data, Azure DevOps account links, and provider identity mappings.
