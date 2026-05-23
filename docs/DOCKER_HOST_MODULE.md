# Docker Host Module

Project Manager runs as a Docker Host shell module. Docker Host owns authentication, module assignment, and access to the app. Project Manager uses the signed Host identity token to create or update local module user records and stores module-specific administrator rights in its own database.

There is no standalone mode. Direct browser or API access without Docker Host identity is rejected, except for the health endpoint.

## User Access

- Docker Host users are the only supported users.
- Local login, invitations, password changes, and logout are disabled.
- Requests must include a valid signed `X-Docker-Host-Identity` token issued by Docker Host.
- The first Host user that opens the module becomes a module administrator. Host administrators also receive module administrator rights.
- Settings are visible only to module administrators.

## Module Packaging

- Source module metadata is defined in `metadata.json`.
- The checked-in metadata uses the source image tag. The Docker publish workflow renders an installable metadata artifact with the immutable `sha-<commit>` image tag for the image it just pushed.
- The app container listens on port `3000`.
- Persistent data is stored in `/app/data`.
- `/api/health` checks database readiness and writable module storage without requiring browser cookies.

## Data

The module uses SQLite for application data. Docker Host should mount module-owned persistent storage to `/app/data` so the database and backups survive container replacement.

The database is created from the current schema when the module starts with empty storage. Previous local-auth schemas are not migrated.

A one-time JSON import is available in Settings for migration data. It imports the supported Project Manager JSON export format into the current Docker Host user and active project.

The main data groups are:

- Host user mappings and Project Manager administrator flags.
- Projects, project membership, and project settings.
- Tasks, time entries, day-offs, blockers, and checklist items.
- Releases, release work items, and release work item children.
- Module backup files under `/app/data/backups`.

## Runtime Contract

- `DOCKER_HOST_MODULE_ID` identifies the module audience for Host identity tokens.
- `DOCKER_HOST_INTERNAL_ORIGIN` or `DOCKER_HOST_IDENTITY_JWKS_URL` must allow the module to resolve Docker Host JWKS.
- Docker Host should not forward Host session cookies to the module.
- Project Manager trusts only the signed Host identity token after signature, issuer, audience, and expiration validation.
