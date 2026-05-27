# Docker Host Module

Project Manager runs as a Docker Host shell module. Docker Host owns authentication, module assignment, app discovery, and access to the app. Project Manager uses the signed Host identity token to create or update local module user records and stores module-specific administrator rights in its own database.

There is no standalone mode. Direct API access without Docker Host identity is rejected, except for the health and identity bootstrap endpoints. Direct browser access without Docker Host identity renders only the module identity bootstrap state and does not expose application data.

## User Access

- Docker Host users are the only supported users.
- Local login, invitations, password changes, and logout are disabled.
- Requests must include a valid signed Docker Host identity token issued by Docker Host.
- Shell iframe traffic receives identity through the Docker Host `postMessage` bridge and exchanges it at `/api/auth/bootstrap` for an HttpOnly module-origin cookie.
- Gateway and service/API traffic can still use the `X-Docker-Host-Identity` header.
- The first Host user that opens the module becomes a module administrator. Host administrators also receive module administrator rights.
- Settings are visible only to module administrators.
- Module administrators can manage Project Manager roles for assigned Host users from the Docker Host scoped directory before those users first open the module.

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

## Data

The module uses SQLite for application data. Docker Host should mount module-owned persistent storage to `/app/data` so the database and backups survive container replacement.

The database is created from the current schema when the module starts with empty storage. Previous local-auth schemas are not migrated.

A one-time JSON import is available in Profile settings for migration data. It imports the supported Project Manager JSON export format into the current Docker Host user and active project.

The main data groups are:

- Host user mappings and Project Manager administrator flags.
- Projects, project membership, and project settings.
- Module-level settings, including AI provider base URL and selected model.
- Per-user credentials such as Azure DevOps Personal Access Tokens.
- Tasks, time entries, day-offs, blockers, and checklist items.
- Releases, release work items, and release work item children.
- Module backup files under `/app/data/backups`.

## Runtime Contract

- `DOCKER_HOST_MODULE_ID` identifies the module audience for Host identity tokens.
- `DOCKER_HOST_INTERNAL_ORIGIN` or `DOCKER_HOST_IDENTITY_JWKS_URL` must allow the module to resolve Docker Host JWKS.
- `DOCKER_HOST_MODULE_SERVICE_TOKEN` allows Project Manager to read the Docker Host scoped directory for users assigned to this module.
- Docker Host should not forward Host session cookies to the module.
- Project Manager trusts only the signed Host identity token after signature, issuer, audience, and expiration validation.
- Direct-origin shell iframe traffic uses the `project_manager_module_identity` HttpOnly cookie after `/api/auth/bootstrap`; the cookie stores the signed Host token and is refreshed by the client bridge before token expiry.
- The client bridge stores only a non-secret identity fingerprint in `sessionStorage` so it can detect Host account switches before the old HttpOnly module cookie expires.
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

## Navigation

The module UI uses a Docker Host-friendly top navigation bar instead of an application sidebar. The stable navigation paths match the module metadata:

- Time Management: `/`
- Planning: `/release-planner`
- Calendar: `/day-offs`
- Settings: `/settings`

Settings navigation is rendered for all assigned module users. Non-admin users see only Profile settings, while Project Manager module administrators also see project, role, release, backup, and AI provider settings. Project switching lives in the top bar as a compact selector.

The module currently renders in the light theme by default. Future Docker Host theme integration should replace the hardcoded light theme with a Host-provided theme signal.
