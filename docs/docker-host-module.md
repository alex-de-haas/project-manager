# Docker Host Module

Project Manager runs as a Docker Host shell module. Docker Host owns authentication, module assignment, app discovery, access to the app, and administrator status. Project Manager uses the signed Host identity token to create or update local module user records and keeps project membership for non-admin users in its own database.

There is no standalone mode. Direct API access without Docker Host identity is rejected, except for the health and identity bootstrap endpoints. Direct browser access without Docker Host identity renders only the module identity bootstrap state and does not expose application data.

## Implemented Scope

The Docker Host module migration is implemented in the application runtime and packaging:

- Host users are the only supported users.
- Host-issued module identity tokens are validated for signature, issuer, audience, and expiration.
- Project Manager maps the Host token `sub` claim to `users.host_user_id` and uses the local integer user id only for internal joins.
- Host administrator status is derived from the signed `host.admin` role and cached on the local user record.
- Local login, invitation, password change, logout, and local role-management flows are not part of the runtime.
- Project Manager creates a fresh SQLite database from the current schema when module storage is empty.
- Project data, project membership, planning data, time-management data, Azure DevOps settings, AI settings, backups, blockers, checklists, and releases are module-owned data.
- JSON migration import remains available for supported legacy Project Manager export files.
- The module is packaged through Docker Host metadata and published as an image-backed service.

## User Access

- Docker Host users are the only supported users.
- Local login, invitations, password changes, and logout are disabled.
- Requests must include a valid signed Docker Host identity token issued by Docker Host.
- Shell iframe traffic receives identity through the Docker Host `postMessage` bridge and exchanges it at `/api/auth/bootstrap` for an HttpOnly module-origin cookie.
- Gateway and service/API traffic can still use the `X-Docker-Host-Identity` header.
- Host administrators receive administrative access in Project Manager automatically.
- Settings are visible to all assigned module users; administrative settings are visible only to Host administrators.
- Project Manager does not have separate application role management. Non-admin project access is configured per project.
- Project assignment uses the Docker Host scoped module directory. Host administrators can synchronize assigned Host users into local records and assign non-admin users to projects.
- Host administrators automatically have access to all projects and are not explicitly assigned as project members.

## Module Packaging

- Source module metadata is defined in `metadata.json` using schema `0.3` image-backed services.
- Local process development metadata is defined in `metadata.dev.json`.
- The checked-in metadata is a template. The Docker publish workflow renders installable metadata with the immutable `sha-<commit>` image tag for the image it just pushed.
- The workflow publishes rendered metadata as `metadata.json` on the `latest` GitHub release. Docker Host can install from `https://github.com/alex-de-haas/project-manager/releases/download/latest/metadata.json`.
- The app container listens on port `3000`.
- Persistent data is stored in `/app/data`.
- `/api/health` checks database readiness and writable module storage without requiring identity.
- `/api/auth/bootstrap` verifies a Host-issued module identity token and stores it in a short-lived module cookie for direct-origin shell iframe traffic.
- The iframe bridge compares each new Host token identity with the currently rendered module identity and immediately re-bootstraps and reloads when the Docker Host account changes.
- The iframe bridge schedules silent refresh from the Host token `exp`, also refreshes on focus or page restore, and guards same-origin API calls so unsafe mutations do not fail only because the module cookie expired in the background.

## Data

The module uses SQLite for application data. Docker Host should mount module-owned persistent storage to `/app/data` so the database and backups survive container replacement.

The database is created from the current schema when the module starts with empty storage. Previous local-auth schemas are not migrated.

A one-time JSON import is available in Profile settings for migration data. It imports the supported Project Manager JSON export format into the current Docker Host user and active project.

The main data groups are:

- Host user mappings and cached Host administrator flags.
- Projects, project membership, and project settings.
- Module-level settings, including AI provider base URL and selected model.
- Per-user credentials such as Azure DevOps Personal Access Tokens.
- Tasks, time entries, days off, blockers, and checklist items.
- Releases, release work items, and release work item children.
- Module backup files under `/app/data/backups`.

## Project And Provider Configuration

Docker Host owns module access. Project Manager owns project-level configuration after a Host user reaches the module.

- Project creation requires a project name. Host administrators can assign non-admin Host users to a project.
- Azure DevOps project configuration is project-level data. Project Manager stores the organization and project parsed from the configured Azure DevOps project URL.
- Azure DevOps PAT credentials are per-user profile credentials. API responses expose only whether a PAT exists and never return the secret value.
- Azure DevOps import, export, refresh, and status synchronization use the current Host user's PAT.
- Manual project, release, task, time-management, blocker, and checklist workflows remain available without an Azure DevOps PAT.
- AI provider configuration is module-level data restricted to Host administrators. It stores an OpenAI-compatible provider base URL and selected model.
- Checklist generation is available only when the AI provider URL and model are configured.
- Database backup and restore operations are administrative module settings.

## Runtime Contract

- `DOCKER_HOST_MODULE_ID` identifies the module audience for Host identity tokens.
- `DOCKER_HOST_INTERNAL_ORIGIN` or `DOCKER_HOST_IDENTITY_JWKS_URL` must allow the module to resolve Docker Host JWKS.
- `DOCKER_HOST_MODULE_SERVICE_TOKEN` allows Project Manager to read the Docker Host scoped directory for users assigned to this module.
- Docker Host should not forward Host session cookies to the module.
- Project Manager trusts only the signed Host identity token after signature, issuer, audience, and expiration validation.
- Direct-origin shell iframe traffic uses the `project_manager_module_identity` HttpOnly cookie after `/api/auth/bootstrap`; the cookie stores the signed Host token and is refreshed by the client bridge before token expiry.
- The client bridge stores only a non-secret identity fingerprint and expiry timestamp in `sessionStorage` so it can refresh before expiry and detect Host account switches before the old HttpOnly module cookie expires.
- The module UI must allow being framed by the Docker Host shell origin. Docker Host no longer rewrites Project Manager HTML, assets, RSC requests, or API calls through an embed proxy.

## Local Development

Project Manager includes `metadata.dev.json` for Docker Host developer mode. From the repository root, run:

```bash
docker-host dev up
```

The dev metadata starts the Next.js app on local port `3100` and links the public `http` endpoint through Docker Host. Use `.docker-host/dev.json` when the local loop should also seed the development Host user, assignment, and scoped directory email policy:

```bash
docker-host dev up --manifest .docker-host/dev.json
```

When Docker Host runs on a non-default local URL, pass that URL explicitly:

```bash
docker-host dev up --manifest .docker-host/dev.json --host-url http://localhost:<host-port>
```

For direct API probes against the local module origin, prepare the developer target and request a Host-signed development identity token:

```bash
TOKEN="$(docker-host dev identity --manifest .docker-host/dev.json --format token)"
curl -H "X-Docker-Host-Identity: $TOKEN" http://127.0.0.1:3100/api/auth/session
```

Gateway and shell integration should still be checked through the Host URL printed by `docker-host dev up`; direct-origin probes only validate endpoint behavior with a real Host-signed token.

## Navigation

The module UI uses a Docker Host-friendly top navigation bar instead of an application sidebar. The stable navigation paths match the module metadata:

- Time Management: `/`
- Planning: `/release-planner`
- Calendar: `/day-offs`
- Settings: `/settings`

Settings navigation is rendered for all assigned module users. Non-admin users see only Profile settings, while Docker Host administrators also see project, release, backup, and AI provider settings. Project switching lives in the top bar as a compact selector.

The module currently renders in the light theme by default. Future Docker Host theme integration should replace the hardcoded light theme with a Host-provided theme signal.

## Validation

Use these checks when changing the module contract or preparing a release:

- Run `npm run build` to verify the Next.js application and TypeScript compilation.
- Run `npm run module:metadata -- --tag sha-test --output /tmp/project-manager-metadata.json` to verify metadata rendering.
- Build the production image locally with Docker when packaging changes affect the runtime image.
- Smoke-test `/api/health` in the built container; it should be public and return database/storage readiness.
- Verify normal app and API requests reject missing Host identity.
- Verify direct-origin iframe bootstrap with a real Docker Host-issued module identity token.
- Verify assigned Host users can access the module through Docker Host.
- Verify non-admin users cannot access administrative Settings APIs or administrative Settings UI.
- Verify Host administrators can manage projects, project settings, releases, backups, and AI provider settings.
- Verify JSON import with a supported legacy export file when migration behavior changes.
- Verify per-user Azure DevOps PAT behavior after Azure DevOps-related changes.
