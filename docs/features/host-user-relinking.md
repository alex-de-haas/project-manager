# Feature: Host User Email Relinking

## Goal

Preserve existing Project Manager user data when Hosty regenerates Host user IDs but keeps user email addresses stable.

When a Hosty user opens Project Manager with a new Hosty user ID, or when Project Manager synchronizes the Hosty app directory, Project Manager should reuse the existing local user record with the same email instead of creating a new local user. This keeps the local `users.id` stable, so project membership, Azure DevOps PAT credentials, provider identities, time entries, days off, releases, and assigned work remain attached to the correct person.

## Non-goals

- Do not add a Profile UI for manual user claiming in this iteration.
- Do not merge data from an already-created duplicate local user.
- Do not automatically relink when email is missing.
- Do not automatically relink when more than one local user matches the same email.
- Do not change Azure DevOps PAT storage or provider identity mapping.
- Do not change Hosty authentication or app identity token validation.

## Current Behavior

Project Manager maps Hosty users by `users.host_user_id`.

When a request has a trusted Hosty identity, `ensureHostUser()` looks up a local user by Hosty user ID. If no local user exists for that Hosty ID, Project Manager creates a new local user.

If Hosty regenerates user IDs, the same person can receive a new local `users.id` even though their email is unchanged. Existing app data remains attached to the old local user and is no longer visible to the person after login.

## Proposed Behavior

When `ensureHostUser()` receives a trusted Hosty identity, or `upsertHostDirectoryUsers()` receives a Hosty directory user:

1. Look up the local user by `host_user_id`.
2. If found, update the existing Hosty-derived fields as today and return that user.
3. If not found and the trusted identity has an email, look for an existing local user with the same normalized email.
4. If exactly one matching local user is found, update that row with the new `host_user_id`, Hosty name, email, and admin flag, then return the same local `users.id`.
5. If no matching user is found, create a new local user as today.
6. If multiple matching users are found, do not relink automatically. Create the new local user as today or fail only if existing database constraints require it.

The relink is global to the local user record. It is not scoped to a Project Manager project or to a specific integration provider.

## User/API Scenarios

Scenario: user has an existing Project Manager account and Hosty regenerates their Host user ID.

- Existing local user: `users.id = 12`, `host_user_id = old-host-id`, `email = user@example.com`.
- New trusted Hosty identity: `id = new-host-id`, `email = user@example.com`.
- Project Manager does not find `new-host-id`.
- Project Manager finds exactly one local user with `user@example.com`.
- Project Manager updates local user `12` to `host_user_id = new-host-id`.
- The user continues seeing their existing projects, Azure DevOps link, tasks, time entries, and days off.

Scenario: a genuinely new Hosty user opens Project Manager.

- No local user has the new Hosty ID.
- No local user has the trusted email.
- Project Manager creates a new local user as today.

Scenario: Hosty identity has no email.

- Project Manager cannot use email relinking.
- Project Manager creates a new local user as today.

Scenario: duplicate local users share the same email.

- Project Manager does not choose a user automatically.
- This iteration does not provide a merge or manual claim flow.

## Technical Design

The change belongs in `src/lib/host-users.ts`, inside the user resolution paths used by `ensureHostUser()` and `upsertHostDirectoryUsers()`.

Email matching should be based on trusted Hosty identity email only. The comparison should be case-insensitive and trimmed.

The existing local user's internal id must remain unchanged. The implementation should update only Hosty-derived identity fields:

- `host_user_id`
- `name`
- `email`
- `is_admin`
- `updated_at`

The app-local display name should remain stable for existing users. If `app_display_name` is missing, initialize it to the resolved Hosty display name.

The existing `buildUniqueName()` logic should still prevent conflicts with the unique `users.name` constraint.

## Data Model / API Changes

No table or public API changes are required.

Affected table:

- `users`: update an existing row's `host_user_id` when a unique email match is found.

Affected indexes:

- `idx_users_normalized_email`: expression index on `lower(trim(email))` for the relink lookup used during login and Hosty directory synchronization.

Existing APIs continue resolving the current user through the authenticated Hosty identity.

## Edge Cases

- Email matching must ignore case and surrounding whitespace.
- If the trusted Hosty identity has no email, skip relinking.
- If multiple users match the normalized email, skip relinking to avoid an unsafe automatic choice.
- If another user already has the incoming `host_user_id`, the normal Hosty ID lookup path should return that user before email relinking runs.
- Hosty directory synchronization uses the same email relinking rule so administrative user sync does not create new duplicates before users log in.
- Existing duplicate-user repair is intentionally out of scope for this iteration.

## Testing Plan

Unit-level or focused integration tests should cover:

- Existing `host_user_id` path still updates and returns the same local user.
- Missing `host_user_id` with exactly one email match relinks that existing user.
- Hosty directory sync relinks an existing local user by email instead of inserting a duplicate.
- Missing `host_user_id` with no email match creates a new user.
- Missing email does not relink.
- Multiple email matches do not relink.

Regression checks:

- Run `npm run build`.
- Verify Profile still shows an existing Azure DevOps account link after relinking because `users.id` did not change.
- Verify project membership for non-admin users remains available after relinking.

## Rollout / Migration Notes

This is a forward-looking login-time repair for users who have not yet opened Project Manager after Hosty ID regeneration.

If a duplicate local user has already been created before this change is deployed, this iteration does not automatically repair that duplicate. Those cases require manual database repair or a later explicit merge/claim feature.

## Open Questions

- Question: Is Hosty email stable and unique across regenerated users?
  Why it matters: email becomes the migration key for automatic relinking.
  Recommended answer: yes, treat trusted Hosty email as stable and unique for this migration scenario.

- Question: Should Project Manager fail loudly when multiple local users share the same email?
  Why it matters: silent new-user creation may hide a data issue, while failing login could block access.
  Recommended answer: skip relinking and create a new user for now, then handle duplicate cleanup manually if encountered.

- Question: Should existing duplicate local users be merged automatically?
  Why it matters: automatic merge can affect many user-owned tables and is higher risk.
  Recommended answer: no for this iteration. Add a separate admin/manual merge feature only if this case appears in production.
