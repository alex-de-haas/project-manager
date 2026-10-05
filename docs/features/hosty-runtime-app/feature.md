---
created: 2026-06-02
updated: 2026-10-04
summary: Project Manager runs as a Hosty runtime app that relies on Core for login, roles, assignments and app access.
---

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
- Shell opens the app origin. The shared SDK identity bridge performs sign-in directly through Core: an embedded app opens a popup from the sign-in button; a standalone app can redirect through Core.
- Project Manager exchanges the one-time code at `/api/auth/app-code`. The SDK retains the returned app grant in memory and sends it on same-origin API requests, including when the browser blocks the app cookie. Credentials are never sent to Shell or saved in browser storage. The SDK validates the popup origin, source and state.
- Same-origin APIs revalidate the grant through Core `/api/auth/apps/revalidate` using the app service token. Protected pages load their user and project context through that API, after the SDK bridge completes sign-in.
- Direct probes can pass the same app identity token through `Authorization: Bearer`.
- Host administrators receive administrative access in Project Manager automatically.
- Settings are visible to all assigned app users; administrative settings are visible only to Host administrators.
- Project Manager does not have separate application administrator role management. Non-admin project access is configured per project.
- Project assignment uses the Hosty scoped app directory. Host administrators can synchronize assigned Hosty users into local records and assign non-admin users to projects.
- Login-time user resolution and scoped directory synchronization both reuse an existing local user when no local row matches the incoming Hosty ID and exactly one local row matches the trusted normalized email.
- Host administrators automatically have access to all projects and are not explicitly assigned as project members.

## App Packaging

- Production app contract: `manifest.json`, schema `app.0.1`.
- Runtime profiles: `docker` (default) and `dev` (`localCommand`, `development: true`).
- The development profile uses the source folder selected in Hosty, including a custom source override, and adopts source manifest edits on restart. `npm run dev` supplies Next.js hot reload. The profile name alone does not enable development behavior.
- Runtime service: `app`, image `ghcr.io/alex-de-haas/project-manager`, container port `3000`.
- Local command runtime service: `app`, command `npm run dev`, with the local port assigned by Hosty Core.
- Public endpoint: `http`.
- Shell UI entrypoint: `/`.
- Primary app data: enabled and mounted to `/app/data`.
- CI renders `manifest.json` with the immutable `sha-<commit>` image tag and publishes it on the `latest` GitHub release.

### Runtime image

- The image ships the Next standalone bundle: `.next/standalone` at `/app`, plus `.next/static` and `public/` copied alongside it. It carries no full `node_modules` — standalone output traces only the packages the server requires, leaving build-only weight such as the SWC binaries out of the image.
- Standalone output is opt-in through `NEXT_OUTPUT_STANDALONE=1`, which the Dockerfile's builder stage sets. A plain `npm run build` outside Docker does not emit the bundle, so `npm run start` (`next start`) keeps working and keeps the data directory at `./data`.
- The container starts `node server.js` through `docker-entrypoint.sh`, never as root. The entrypoint runs privileged only long enough to decide which uid to run as, then drops with `gosu`.
- The runner image sets `HOSTNAME=0.0.0.0` so the standalone server listens on all IPv4 interfaces, including loopback. The manifest healthcheck requests `http://127.0.0.1:3000/api/health`; binding only to Docker's default container hostname makes that check fail even when proxied requests succeed.
- It **adopts the data mount's existing owner** rather than taking ownership of it. Hosty Core bind-mounts the directory from its own app tree, owned by the user running Core — normally not root. Chowning it to the image's uid would take it away from Core on any host whose Core uid differs, and Core's uninstall path swallows the resulting error, so removing the app with its data would report success while leaving the data on disk. Ownership is assigned only when the directory is root-owned, where nothing else holds a claim.
- Because the server may therefore run as an arbitrary uid, the Next image-optimizer cache directory is mode `1777` — sticky like `/tmp`, holding only derived, non-secret output.
- The base image is pinned by digest, and every `COPY` into the runner stage stamps `node:node` ownership directly rather than running a recursive `chown` afterwards.
- The base is `node:24-trixie-slim` (Debian 13, glibc 2.41) because `better-sqlite3` 13 bundles prebuilt bindings linked against `GLIBC_2.38`. An older base such as `node:24-bookworm-slim` (glibc 2.36) cannot load them, and the failure lands on the image build rather than at runtime: `next build` imports `src/lib/db.ts`, whose module-level `new Database(...)` opens the database, so an unloadable binding surfaces as `Failed to collect page data`. Any future base-image change has to keep the glibc floor the installed `better-sqlite3` requires.
- The `deps` stage keeps `python3 make g++` even though `better-sqlite3` now ships prebuilds, because whether npm runs its `node-gyp rebuild` install script differs between the CI runner and a local build. Both the compile path and the prebuild path have to work.

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
- `HOSTY_APP_SERVICE_TOKEN` allows Project Manager to revalidate app identity tokens with Core and read the scoped directory for users assigned to this app.
- Hosty should not forward Hosty session cookies to the app.
- Project Manager trusts a request only after Core confirms the app identity token is active, has the expected app id, and has not expired.
- The `project_manager_hosty_identity` HttpOnly app-origin cookie stores the Core app identity token returned by `/api/auth/apps/token`. The cookie lifetime follows Core's returned token lifetime. It uses `SameSite=None` and `Secure` for HTTPS so the token is available when Project Manager is embedded by Hosty Shell as an app iframe. In local HTTP development contexts, it uses `SameSite=Lax` without `Secure`; separate named local origins and cross-site frames use the memory grant when cookies are unavailable.
- On navigation with a Core `code`, the SDK removes it from the URL, exchanges it once and probes the session without reloading. The identity probe accepts bearer grants and cookies, and returns SDK recovery and activity metadata. A fresh bearer grant takes precedence over an old cookie. An active resolution with a missing, invalid or expired expiry is reported as expired, matching protected API validation.
- The bridge gates initial rendering and keeps the active page mounted while renewing access, preserving drafts. A full browser reload can require sign-in again when third-party cookies are blocked because the fallback grant is memory-only.
- User and project context come from `/api/auth/session`; administrative settings visibility follows the returned user role. API authorization remains server-enforced.
- Project selection also lives in memory and accompanies API calls as `X-Project-Id`. Every handler still validates project membership; a selection grants no access. Existing selection cookies remain a convenience when the browser accepts them. Switching projects refreshes app context without a full document reload. If the selected project was deleted or access was revoked, the session endpoint returns 404 or 403. The context loader clears that stale selection and retries the read once without it, preserving the app grant and letting the server select an accessible project.
- App identity revalidation calls use the SDK's bounded positive cache and in-flight deduplication. Failed validations do not grant access.

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

The navigation links render only in `standalone` launches; under a shell they are hidden as duplicated chrome (see Launch Mode Detection below) and the top bar reduces to the project switcher.

## Hosty Theme Integration

Project Manager follows the Hosty Shell theme through the SDK's theme slice (`@hosty-sdk/app/theme`,
`HostThemeBridge` from `@hosty-sdk/app/react`), which owns the protocol: the `hosty_theme` /
`hosty_theme_preference` launch parameters decide the theme a document loads with, the value
persisted for the tab carries it across app-internal navigation, and the `hosty:shell-theme`
`postMessage` covers changes while the frame is up. The root layout mounts the SDK's bootstrap
(`createThemeBootstrapScript`) ahead of any markup so the first paint is already in the shell's
theme, and the bridge cleans the parameters out of the URL afterwards.

What stays in the app is the hand-off to `next-themes`, in `src/components/HostThemeBridge.tsx`: the
bridge's `onTheme` callback passes each theme a shell declared to `setTheme`, so app components that
render off `next-themes` state (notifications, the toggle) follow too. Both the bridge and the
bootstrap are created with `followSystem: false`, because `next-themes` owns the standalone case —
when Hosty provides no theme signal, Project Manager keeps the normal `next-themes` behavior, and the
operating system never overwrites a theme the operator picked with the toggle.

## Launch Mode Detection

The root layout runs the app SDK's `launchModeBootstrapScript` in `<head>` and mounts `HostLaunchBridge`, which resolve the launch mode — a shell-declared `hosty_launch` query parameter (`embedded`, `native`, or `standalone`) first, then the value persisted for the tab, then the frame heuristic — and stamp it onto `<html>` as `data-hosty-launch`. The top navigation links (both the desktop bar and the mobile menu) duplicate the manifest `ui.navigation` a surrounding shell renders, so they carry the SDK's `hosty-shell-chrome` class and are hidden by an unlayered CSS rule whenever the mode is not `standalone`. The project switcher is contextual — no shell renders one — so it stays visible in every launch mode; under a shell the header card collapses around it.

## Testing Expectations

Use these checks when changing the app contract or preparing a release:

- Run `npm run build` to verify the Next.js application and TypeScript compilation.
- Run `npm run app:manifest -- --tag sha-test --output /tmp/project-manager-manifest.json` to verify manifest rendering.
- Build the production image locally with Docker when packaging changes affect the runtime image.
- Run the manifest's exact healthcheck command in the built container against `127.0.0.1:3000`, and smoke-test `/api/health` through the published port; both should succeed without identity and return database/storage readiness.
- After a packaging change, verify in the built container that the server process runs as uid 1000, that `/app/data` is writable, and that a `/_next/static/…` asset is served — the standalone bundle copies static assets separately, so a missing copy only shows up as broken assets, not a failed start.
- After a packaging change, verify `npm run start` still serves `/api/health` outside Docker, so the standalone opt-in has not leaked into local builds.
- Verify protected APIs reject missing or forged Hosty identity, while the page bootstrap displays the SDK sign-in state.
- Verify embedded popup completion when app cookies are blocked, bearer-authenticated API requests, renewal without draft loss, and project switching without document reload.
- Run `npm test` and `npm run lint`; identity-probe and browser-API regressions cover memory grants, activity metadata, forged internal headers, expiry consistency and cross-origin rejection. Cover deleted/revoked project selection, bounded context fallback and preservation of the app grant.
- Verify app-code exchange with a real Core-issued app authorization code.
- Verify direct-origin API probes with a real Core-issued app identity token.
- Verify assigned Hosty users can access the app through Hosty Shell.
- Verify regenerated Hosty user IDs relink to existing local users when trusted email is unchanged and unique.
- Verify non-admin users cannot access administrative Settings APIs or administrative Settings UI.
- Verify Host administrators can manage projects, project settings, releases, backups, and AI provider settings.
- Verify JSON import with a supported legacy export file when migration behavior changes.
- Verify project-scoped per-user Azure DevOps link behavior after Azure DevOps-related changes.
- After changes to the top navigation or the launch bridges, verify a plain tab shows the nav links while `?hosty_launch=embedded` hides them and keeps the project switcher, and that the parameter is cleaned from the URL.
