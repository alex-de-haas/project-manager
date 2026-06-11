# Hosty Runtime App

Project Manager runs as a Hosty runtime app. Hosty Core owns login, Hosty roles, app assignment, app discovery, Shell app links, and app access. Project Manager uses the Core app identity session to create or update local Host user records and keeps project membership for non-admin users in its own database.

There is no anonymous standalone mode. Direct API access without Hosty app identity is rejected, except for the health and app-code exchange endpoints. Direct browser access without identity renders only the identity bootstrap state and does not expose application data.

## Implemented Scope

- Hosty users are the only supported users.
- Host-issued app identity tokens are revalidated with Core before Project Manager trusts the request.
- Project Manager maps the Core app session `userId` to `users.host_user_id` and uses the local integer user id only for internal joins.
- When Hosty regenerates user IDs but preserves user email addresses, Project Manager can relink a new Hosty user ID to the existing local user by trusted email so the local integer user id remains stable.
- Host administrator status is derived from Core's `host.admin` role and cached on the local user record.
- Local login, invitation, password change, logout, and local role-management flows are not part of the runtime.
- Project Manager creates a fresh SQLite database from the current schema when app storage is empty.
- Project data, project membership, planning data, time-management data, Azure DevOps settings, AI settings, backups, blockers, checklists, and releases are app-owned data.
- JSON migration import remains available for supported legacy Project Manager export files.
- The app is packaged through `manifest.json` using `schemaVersion: "app.0.1"`.

## User Access

- Requests must include a valid signed Hosty app identity token issued by Hosty Core.
- Shell opens the app origin with a Core-issued app authorization code.
- Project Manager exchanges the launch code at `/api/auth/app-code` through Core `/api/auth/apps/token`, then stores the app identity token in an HttpOnly app-origin cookie. The root client bridge follows the Hosty Demo App pattern: remove the code from the visible URL, exchange it, then reload after success.
- Server-rendered pages and same-origin APIs revalidate that token through Core `/api/auth/apps/revalidate`.
- Direct probes can pass the same app identity token through `Authorization: Bearer`.
- Host administrators receive administrative access in Project Manager automatically.
- Settings are visible to all assigned app users; administrative settings are visible only to Host administrators.
- Project Manager does not have separate application administrator role management. Non-admin project access is configured per project.
- Project assignment uses the Hosty scoped app directory. Host administrators can synchronize assigned Hosty users into local records and assign non-admin users to projects.
- Login-time user resolution and scoped directory synchronization both reuse an existing local user when no local row matches the incoming Hosty ID and exactly one local row matches the trusted normalized email.
- Host administrators automatically have access to all projects and are not explicitly assigned as project members.

## App Packaging

- Production app contract: `manifest.json`, schema `app.0.1`.
- Runtime profiles: `docker` and `dev`.
- Runtime service: `app`, image `ghcr.io/alex-de-haas/project-manager`, container port `3000`.
- Local command runtime service: `app`, command `npm run dev`, with the local port assigned by Hosty Core.
- Public endpoint: `http`.
- Shell UI entrypoint: `/`.
- Primary app data: enabled and mounted to `/app/data`.
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

- Host user mappings, trusted-email relinking state through `users.host_user_id`, and cached Host administrator flags.
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

- `HOSTY_APP_ID` is the app audience id used by Core app identity.
- `HOSTY_CORE_ORIGIN` is the Core origin used for app code exchange, token revalidation, and scoped directory access.
- `HOSTY_APP_SERVICE_TOKEN` allows Project Manager to read the scoped directory for users assigned to this app.
- Hosty should not forward Hosty session cookies to the app.
- Project Manager trusts a request only after Core confirms the app identity token is active, has the expected app id, and has not expired.
- The `project_manager_hosty_identity` HttpOnly app-origin cookie stores the Core app identity token returned by `/api/auth/apps/token`. The cookie lifetime follows Core's returned token lifetime. It uses `SameSite=None` and `Secure` for HTTPS so the token is available when Project Manager is embedded by Hosty Shell as an app iframe. In local HTTP development contexts, it uses `SameSite=Lax` without `Secure`; Shell and runtime apps on `localhost` with different ports are same-site for this purpose, and Safari does not reliably accept `Secure` cookies over plain HTTP localhost.
- On browser navigation with a Hosty launch `code`, the client bridge posts the code to `/api/auth/app-code`, removes `code` from the visible URL, and reloads after successful exchange so the protected layout can read the app identity cookie.
- Launch-code navigations are bootstrap-only even when an older app identity cookie is still valid. The initial request does not render protected app content from the old cookie, preventing a stale page from flashing before the new code exchange reloads the app.
- App identity revalidation calls to Core are cached in memory for a short TTL and concurrent revalidations for the same token are coalesced. This reduces repeated Core authorization calls during page loads while still bounding stale authorization state.
- The app-code bridge keeps the authorization code retryable when exchange cannot complete. If Core exchange fails, Project Manager shows a retryable Hosty authorization error instead of silently leaving the user on the unauthenticated bootstrap state.

## Local Development

Project Manager includes a `dev` runtime in `manifest.json` for Core-managed local development. From the repository root, run:

```bash
hosty core start
hosty apps install manifest.json --runtime dev
hosty apps start com.haas.project-manager
```

The `dev` runtime starts the Next.js app on a Core-assigned local port, injects `HOSTY_CORE_ORIGIN`, `HOSTY_APP_ID`, `HOSTY_APP_SERVICE_TOKEN`, `HOSTY_APP_DATA_DIR`, `HOSTY_PORT_HTTP`, and `PORT`, and links the public `http` endpoint through Hosty.

For direct API probes against the local app origin, request a Core app identity token:

```bash
TOKEN="$(hosty apps identity com.haas.project-manager --user user@docker-host.local --format token)"
curl -H "Authorization: Bearer $TOKEN" <assigned-project-manager-origin>/api/auth/session
```

Shell integration should still be checked through the Hosty app link; direct-origin probes only validate endpoint behavior with a real Core app identity token.

## Navigation

The app UI uses a Hosty-friendly top navigation bar. The stable navigation paths match the app manifest:

- Time Management: `/`
- Planning: `/release-planner`
- Calendar: `/day-offs`
- Settings: `/settings`

Settings navigation is rendered for all assigned app users. Non-admin users see only Profile settings, while Host administrators also see project, release, backup, and AI provider settings. Project switching lives in the top bar as a compact selector.

## Hosty Theme Integration

Project Manager supports Hosty Shell theme propagation. Shell launch URLs may include `hosty_theme=light|dark` and `hosty_theme_preference=light|dark|system`. The root layout applies that resolved theme before hydration so the initial embedded render does not flash through the wrong palette.

After launch, the app listens for Shell `postMessage` events with `type: "hosty:shell-theme"`, `theme`, and `preference`. Valid Shell updates apply the `.dark` class on the document root, update `color-scheme`, persist the resolved theme for the current embedded session, and keep `next-themes` in sync for app components such as notifications.

When Hosty does not provide a theme signal, Project Manager falls back to the normal `next-themes` system preference behavior.

## Validation

Use these checks when changing the app contract or preparing a release:

- Run `npm run build` to verify the Next.js application and TypeScript compilation.
- Run `npm run app:manifest -- --tag sha-test --output /tmp/project-manager-manifest.json` to verify manifest rendering.
- Build the production image locally with Docker when packaging changes affect the runtime image.
- Smoke-test `/api/health` in the built container; it should be public and return database/storage readiness.
- Verify normal app and API requests reject missing Hosty identity.
- Verify app-code exchange with a real Core-issued app authorization code.
- Verify direct-origin API probes with a real Core-issued app identity token.
- Verify assigned Hosty users can access the app through Hosty Shell.
- Verify regenerated Hosty user IDs relink to existing local users when trusted email is unchanged and unique.
- Verify non-admin users cannot access administrative Settings APIs or administrative Settings UI.
- Verify Host administrators can manage projects, project settings, releases, backups, and AI provider settings.
- Verify JSON import with a supported legacy export file when migration behavior changes.
- Verify project-scoped per-user Azure DevOps link behavior after Azure DevOps-related changes.
