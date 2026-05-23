# Docker Host Module Migration

## Description

Project Manager is being converted into a Docker Host shell module only. Docker Host owns authentication, Host users, module assignment, and gateway access. Project Manager owns module-specific administrator rights, projects, project membership, planning data, time-management data, Azure DevOps settings, AI settings, and database backups.

There is no standalone mode and no local authentication fallback. A deployed module starts with empty Docker Host-managed storage and creates a fresh SQLite database from the current schema. Legacy local-auth migrations, local user invitations, local password flows, and legacy export flows are not part of the module runtime.

The target module behavior is:

- Host users are the only users.
- Requests require a signed Docker Host identity token, except for `/api/health`.
- The token issuer must be `docker-host`, the audience must match `com.haas.project-manager`, and expired tokens are rejected.
- The token `sub` is the stable Host user principal.
- Project Manager maps Host users into local records for internal joins and module roles.
- Module roles are limited to admin and user.
- Admins can see Settings, manage module roles, manage projects, and configure settings.
- Non-admin users can access Time Management, Planning, and Calendar pages.
- Persistent module state lives under Docker Host-managed module storage.
- JSON migration import remains available for importing supported Project Manager export files into the current Host user and active project.

## Milestones

### Phase 1 - Host-only identity

**Status**: Completed

Replace standalone application identity with Docker Host identity.

Tasks:

- Completed: Remove temporary legacy Docker image publishing.
- Completed: Validate signed `X-Docker-Host-Identity` JWTs against Docker Host JWKS.
- Completed: Require issuer `docker-host`, audience equal to the module id, and non-expired tokens.
- Completed: Use Host token `sub` as the stable user principal through a local `host_user_id` mapping.
- Completed: Remove local login, bootstrap, invitation, password change, and logout routes/pages.
- Completed: Strip client-controlled identity headers before passing trusted Host identity to app routes.
- Completed: Keep `/api/health` public for Docker Host readiness checks.

Recommendation:

- Keep host-only behavior strict. Local development should use Docker Host developer mode or a configured Host JWKS source, not a standalone identity fallback.

### Phase 2 - Module roles and scoped Host users

**Status**: Completed

Keep Docker Host authorization separate from Project Manager permissions.

Tasks:

- Completed: Store module administrator rights on local Host-backed user records.
- Completed: Bootstrap module admin rights for the first Host user and for signed `host.admin` identities.
- Completed: Restrict Settings UI and Settings APIs to module administrators.
- Completed: Remove local user create/delete/rename behavior.
- Completed: Use the Docker Host scoped directory API to list users assigned to this module before they first open the app.
- Completed: Store and manage module roles directly by stable Host user id when scoped directory integration is available.

Recommendation:

- Use `host.admin` for bootstrap and emergency access. Keep normal Project Manager permissions in module-owned storage keyed by stable Docker Host user ids.

### Phase 3 - Fresh module database

**Status**: Completed

Create the module database from the current schema only.

Tasks:

- Completed: Remove legacy database migration ladder.
- Completed: Remove local password and invitation tables/helpers.
- Completed: Add `users.host_user_id` as the stable Host principal mapping.
- Completed: Keep local integer user ids only as internal join keys.
- Completed: Keep projects as module-owned records managed by module admins.
- Completed: Keep project membership and work data scoped by project and Host-backed local user records.
- Completed: Store database and backups under Docker Host module storage.
- Completed: Keep JSON migration import for supported Project Manager export files.

Recommendation:

- Treat the SQLite schema in `src/lib/db.ts` as the fresh install contract. Add future migrations only for future module schema changes, not for the removed standalone schema.

### Phase 4 - Docker Host metadata and runtime contract

**Status**: Completed

Package Project Manager as an installable Docker Host module.

Tasks:

- Completed: Add `metadata.json` with `schemaVersion: "0.2"`.
- Completed: Use stable reverse-DNS module id `com.haas.project-manager`.
- Completed: Declare one app container using port `3000`.
- Completed: Add a public endpoint hint for the Host shell app entrypoint.
- Completed: Add `ui` metadata with entrypoint path `/` and navigation paths for the main pages.
- Completed: Add module storage mapping for `/app/data`.
- Completed: Add CI metadata rendering for immutable `sha-<commit>` image tags.
- Completed: Configure CI to publish rendered metadata as the `metadata.json` asset on the `latest` GitHub release.
- Completed: Publish Docker images as a multi-architecture manifest for `linux/amd64` and `linux/arm64`.
- Completed: Confirm Docker Host automatically injects internal origin, module id, and service token.
- Completed: Run the publish workflow from the Docker Host module branch and verify the release asset URL returns rendered metadata for the pushed image tag.
- Completed: Install the metadata through Docker Host developer mode managed install flow.

Recommendation:

- Keep metadata strict. Schema `0.2` rejects unknown fields, so Host-owned credentials should not be modeled as administrator-entered settings unless Docker Host explicitly requires that. Keep CI publishing both `linux/amd64` and `linux/arm64`, because Docker Host installs on Apple Silicon require an arm64 image manifest.

### Phase 5 - Azure DevOps settings

**Status**: Not Started

Separate project configuration from user credentials.

Tasks:

- Store Azure DevOps organization and project in project settings.
- Store each user's PAT in their own profile credentials.
- Use the current Host user's PAT for import, export, refresh, and status synchronization.
- Block DevOps import/export/sync features when the current user has no PAT.
- Keep manual task and time-management functionality available without a PAT.
- Redact PAT values in all API responses and UI forms.

Recommendation:

- Store only `hasPat` in API responses. If secrets remain in SQLite, encrypt them with a module secret supplied by Docker Host settings.

### Phase 6 - AI provider configuration

**Status**: Not Started

Move AI provider configuration to module-level settings.

Tasks:

- Add a global/module-level provider base URL setting.
- Add a global selected model setting.
- Replace loopback-only LM Studio assumptions with a configured provider URL that works from inside the module container.
- Restrict AI provider configuration to admins.
- Keep checklist generation available only when the provider and model are configured.

Recommendation:

- Configure provider URL through Docker Host module settings when possible, then mirror only non-secret display state in the app database.

### Phase 7 - Host-friendly navigation

**Status**: Not Started

Make the module UI fit inside the Docker Host shell.

Tasks:

- Replace the application sidebar with top navigation for Time Management, Planning, Calendar, and Settings.
- Hide Settings for non-admin users.
- Move project switching into the top bar or another compact project selector.
- Add a user profile entry for personal settings such as Azure DevOps PAT.

Recommendation:

- Keep navigation paths stable so module `ui.navigation` metadata can point to the same pages.

### Phase 8 - Validation

**Status**: In Progress

Verify the app as a production module.

Tasks:

- Completed: Run project lint/build checks for host-only identity and metadata changes.
- Completed: Render module metadata with an immutable test image tag.
- Completed: Build the production Docker image locally.
- Completed: Smoke-test `/api/health` in the built container and verify normal page requests reject missing Host identity.
- Completed: Add JSON migration import endpoint and Settings UI.
- Remaining: Verify Host identity token validation with a real Docker Host-issued token.
- Remaining: Verify assigned Host users can access the app through Docker Host.
- Remaining: Verify non-admin users cannot access Settings APIs or Settings UI.
- Remaining: Verify admins can manage roles, projects, project settings, and AI settings.
- Remaining: Verify JSON migration import with a real exported file.
- Remaining: Verify per-user Azure DevOps PAT behavior after Phase 5.

Recommendation:

- Treat Host identity validation and managed install testing as release blockers.

## Open Questions

- Question: What stable direct URL should Docker Host use for the rendered module metadata artifact?
  Answer: The intended latest-channel URL is `https://github.com/alex-de-haas/project-manager/releases/download/latest/metadata.json`.
  Recommendation: Use the release asset as the Docker Host install URL for the latest channel. Add immutable per-version release assets later if reproducible historical installs are needed.

- Question: What Docker Host internal origin and service token environment names are guaranteed for modules?
  Answer: The implementation expects `DOCKER_HOST_INTERNAL_ORIGIN`, `DOCKER_HOST_MODULE_ID`, and `DOCKER_HOST_MODULE_SERVICE_TOKEN`, with `DOCKER_HOST_IDENTITY_JWKS_URL` available as an explicit JWKS override.
  Recommendation: Keep these names; Docker Host install/update/recovery builds module service environments with the same variables.

- Question: Should selected AI model be global or per project?
  Answer: Current direction is global.
  Recommendation: Start global. Add per-project override only if different projects need different model behavior.

- Question: Should Host users automatically receive access to all projects?
  Answer: Host controls module access, while Project Manager still controls project-level assignment.
  Recommendation: Keep project membership inside the module and let module admins assign Host users to projects.

- Question: Should module administrators be bootstrapped from the first Host user, Host administrators, or both?
  Answer: Current implementation grants admin rights to the first Host user that opens the module and to users whose signed token has `hostRole: "host.admin"`.
  Recommendation: Keep both for bootstrap, then manage normal module roles through the scoped Host directory integration.
