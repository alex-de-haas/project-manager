# Hosty Runtime App

Project Manager runs as a Hosty runtime app. Hosty Core owns login, Hosty roles, app assignment, app discovery, Shell embedding, and app access. Project Manager uses the signed Hosty app identity token to create or update local Host user records and keeps project membership for non-admin users in its own database.

There is no anonymous standalone mode. Direct API access without Hosty app identity is rejected, except for the health and identity bootstrap endpoints. Direct browser access without identity renders only the identity bootstrap state and does not expose application data.

## Implemented Scope

- Hosty users are the only supported users.
- Host-issued app identity tokens are validated for signature, issuer, audience, and expiration.
- Project Manager maps the Host token `sub` claim to `users.host_user_id` and uses the local integer user id only for internal joins.
- Host administrator status is derived from the signed `host.admin` role and cached on the local user record.
- Local login, invitation, password change, logout, and local role-management flows are not part of the runtime.
- Project Manager creates a fresh SQLite database from the current schema when app storage is empty.
- Project data, project membership, planning data, time-management data, Azure DevOps settings, AI settings, backups, blockers, checklists, and releases are app-owned data.
- JSON migration import remains available for supported legacy Project Manager export files.
- The app is packaged through `manifest.json` using `schemaVersion: "app.0.1"`.

## User Access

- Requests must include a valid signed Hosty app identity token issued by Hosty Core.
- Shell iframe traffic receives identity through the Hosty `postMessage` bridge and exchanges it at `/api/auth/bootstrap` for an HttpOnly app-origin cookie.
- Gateway and service/API traffic can still use the legacy `X-Docker-Host-Identity` header while the current compatibility contract uses that header.
- Host administrators receive administrative access in Project Manager automatically.
- Settings are visible to all assigned app users; administrative settings are visible only to Host administrators.
- Project Manager does not have separate application administrator role management. Non-admin project access is configured per project.
- Project assignment uses the Hosty scoped app directory. Host administrators can synchronize assigned Hosty users into local records and assign non-admin users to projects.
- Host administrators automatically have access to all projects and are not explicitly assigned as project members.

## App Packaging

- Production app contract: `manifest.json`, schema `app.0.1`.
- Runtime profile: `docker`.
- Runtime service: `app`, image `ghcr.io/alex-de-haas/project-manager`, port `3000`.
- Public endpoint: `http`.
- Shell UI entrypoint: `/`.
- Primary app data: enabled and mounted to `/app/data`.
- Local process development metadata: `metadata.dev.json`, schema `0.3`, because the current `hosty dev` harness expects process services in legacy metadata format.
- CI renders `manifest.json` with the immutable `sha-<commit>` image tag and publishes it on the `latest` GitHub release.

Stable install URL:

```text
https://github.com/alex-de-haas/project-manager/releases/download/latest/manifest.json
```

## Data

The app uses SQLite for application data. Hosty should mount primary app data storage to `/app/data` so the database and backups survive container replacement.

The database is created from the current schema when app storage is empty. Previous local-auth schemas are not migrated.

A one-time JSON import is available in Profile settings for migration data. It imports the supported Project Manager JSON export format into the current Hosty user and active project.

The main data groups are:

- Host user mappings and cached Host administrator flags.
- Projects, project membership, and project settings.
- App-level settings, including AI provider base URL and selected model.
- Project-scoped per-user external account credentials such as Azure DevOps Personal Access Tokens.
- Tasks, time entries, days off, blockers, and checklist items.
- Releases, release work items, and release work item children.
- App backup files under `/app/data/backups`.

## Project And Provider Configuration

Hosty owns app access. Project Manager owns project-level configuration after a Hosty user reaches the app.

- Project creation requires a project name. Host administrators can assign non-admin Hosty users to a project.
- Azure DevOps project configuration is project-level data. Project Manager stores the organization and project parsed from the configured Azure DevOps project URL.
- Azure DevOps PAT credentials are project-scoped per-user profile credentials. API responses expose only whether a link exists for the active project and never return the secret value.
- Azure DevOps import, export, refresh, and status synchronization use the current Hosty user's PAT for the active project.
- Manual project, release, task, time-management, blocker, and checklist workflows remain available without an Azure DevOps PAT.
- AI provider configuration is app-level data restricted to Host administrators. It stores an OpenAI-compatible provider base URL and selected model.
- Checklist generation is available only when the AI provider URL and model are configured.
- Database backup and restore operations are administrative app settings.

## Runtime Contract

- `HOSTY_APP_ID` is the preferred app audience override for Hosty identity tokens.
- `DOCKER_HOST_MODULE_ID` remains accepted as a legacy compatibility fallback.
- `HOSTY_INTERNAL_ORIGIN` is the preferred Hosty Core origin override.
- `HOSTY_IDENTITY_JWKS_URL` is the preferred explicit JWKS URL override.
- `DOCKER_HOST_INTERNAL_ORIGIN` and `DOCKER_HOST_IDENTITY_JWKS_URL` remain accepted while the identity discovery and JWKS routes use the current compatibility names.
- `HOSTY_APP_SERVICE_TOKEN` allows Project Manager to read the scoped directory for users assigned to this app.
- `DOCKER_HOST_MODULE_SERVICE_TOKEN` remains accepted as a legacy compatibility fallback.
- Hosty should not forward Hosty session cookies to the app.
- Project Manager trusts only the signed Hosty identity token after signature, issuer, audience, and expiration validation.
- Direct-origin Shell iframe traffic uses the `project_manager_hosty_identity` HttpOnly app-origin identity cookie after `/api/auth/bootstrap`; the cookie stores the signed Hosty token and is refreshed by the client bridge before token expiry.
- The client bridge stores only a non-secret identity fingerprint and expiry timestamp in `sessionStorage` so it can refresh before expiry and detect Host account switches before the old HttpOnly app cookie expires.
- The app UI must allow being framed by the Hosty Shell origin.

## Local Development

Project Manager includes `metadata.dev.json` for Hosty developer mode. From the repository root, run:

```bash
hosty dev up
```

The dev metadata starts the Next.js app on local port `3100` and links the public `http` endpoint through Hosty. When Hosty Core runs on a non-default local URL, pass that URL explicitly:

```bash
hosty dev up --host-url http://localhost:<host-port>
```

For direct API probes against the local app origin, prepare the developer target and request a Hosty-signed development identity token:

```bash
TOKEN="$(hosty dev identity --manifest metadata.dev.json --format token)"
curl -H "X-Docker-Host-Identity: $TOKEN" http://127.0.0.1:3100/api/auth/session
```

Gateway and Shell integration should still be checked through the Hosty URL printed by `hosty dev up`; direct-origin probes only validate endpoint behavior with a real Hosty-signed token.

## Navigation

The app UI uses a Hosty-friendly top navigation bar. The stable navigation paths match the app manifest:

- Time Management: `/`
- Planning: `/release-planner`
- Calendar: `/day-offs`
- Settings: `/settings`

Settings navigation is rendered for all assigned app users. Non-admin users see only Profile settings, while Host administrators also see project, release, backup, and AI provider settings. Project switching lives in the top bar as a compact selector.

The app currently renders in the light theme by default. Future Hosty theme integration should replace the hardcoded light theme with a Hosty-provided theme signal.

## Validation

Use these checks when changing the app contract or preparing a release:

- Run `npm run build` to verify the Next.js application and TypeScript compilation.
- Run `npm run app:manifest -- --tag sha-test --output /tmp/project-manager-manifest.json` to verify manifest rendering.
- Build the production image locally with Docker when packaging changes affect the runtime image.
- Smoke-test `/api/health` in the built container; it should be public and return database/storage readiness.
- Verify normal app and API requests reject missing Hosty identity.
- Verify direct-origin iframe bootstrap with a real Hosty-issued app identity token.
- Verify assigned Hosty users can access the app through Hosty Shell.
- Verify non-admin users cannot access administrative Settings APIs or administrative Settings UI.
- Verify Host administrators can manage projects, project settings, releases, backups, and AI provider settings.
- Verify JSON import with a supported legacy export file when migration behavior changes.
- Verify project-scoped per-user Azure DevOps link behavior after Azure DevOps-related changes.
