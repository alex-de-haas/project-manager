# Project Manager

Project Manager is a Hosty runtime app for planning releases, tracking work, recording time, and coordinating project teams. It supports local task management and optional Azure DevOps integration for teams that want to keep delivery planning in sync with work items.

## Overview

The application is organized around a few core workflows:

- **Time tracking**: weekly and monthly views, inline time entry editing, totals by day and work item, status filtering, untracked delegated work warnings, and Excel export.
- **Work management**: local tasks and bugs, task status changes, checklists, blockers, and completion rules that prevent closing work with unfinished checklist items.
- **Release planning**: ordered releases, imported work items, child task visibility, release status tracking, and movement of work between releases.
- **Days off**: personal and team day off tracking with full-day and half-day support.
- **Project administration**: Hosty identity, host-admin settings access, project switching, projects, and per-project user access.
- **Azure DevOps integration**: optional import, export, refresh, status sync, and release planning support for Azure DevOps work items.
- **Database operations**: local SQLite storage with JSON migration import, backup, and restore support.

## Tech Stack

- Next.js 16 with App Router
- TypeScript
- SQLite with `better-sqlite3`
- Tailwind CSS and Radix UI
- dnd-kit
- Sonner notifications
- Azure DevOps Node API
- ExcelJS

## Requirements

- Node.js 20.9 or newer
- npm
- Hosty Core and Shell for authenticated app access

## Setup

Install dependencies:

```bash
npm install
```

Start the standalone development server:

```bash
npm run dev
```

Run the integrated Hosty developer loop from the repository root:

```bash
hosty core start
hosty apps install manifest.json --runtime dev
hosty apps start com.haas.project-manager
```

The `dev` runtime in `manifest.json` runs `npm run dev` through Core's `localCommand` runtime. Hosty assigns an available local port and injects it as `PORT` and `HOSTY_PORT_HTTP`.

The application is Hosty-only. In Hosty Shell, Core opens the app with a short-lived authorization code. The app client bridge exchanges that launch code at `/api/auth/app-code`, stores the returned app identity token in an HttpOnly app-origin cookie, and revalidates that token with Core for server-rendered pages and same-origin API calls.

Direct API requests without Hosty app identity return `401`, except for `/api/health` and `/api/auth/app-code`. Direct browser requests without identity render only the identity bootstrap state.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run app:manifest -- --tag sha-test --output /tmp/project-manager-manifest.json
```

## Data

- Main database: `data/project_manager.db`
- Backups: `data/backups/project_manager_backup_*.db`

Use the Settings area in the app to import supported Project Manager migration JSON, manage database backups, and restore from an existing backup.

## Docker

Build the app image:

```bash
docker build -t project-manager .
```

The source app manifest is available in `manifest.json` using schema `app.0.1` with Docker and `localCommand` runtime profiles for the `app` service. CI renders an installable manifest that points at the immutable `sha-<commit>` image tag pushed to GHCR, then publishes that file as the `manifest.json` asset on the `latest` GitHub release. The stable Hosty manifest URL is:

```text
https://github.com/alex-de-haas/project-manager/releases/download/latest/manifest.json
```

Persistent state is stored under `/app/data` and is intended to be mounted from Hosty-managed primary app data storage.

## Documentation

Documentation index: [docs/root.md](docs/root.md).

## Telemetry

The app exports OpenTelemetry traces and metrics via `@vercel/otel` and bridges `console.*` into OTLP
logs (`src/instrumentation.ts`, `src/otel-logs.ts`), all over OTLP/HTTP. Export is **driven by the
`OTEL_*` environment Hosty Core injects** — when the operator has enabled observability and the
collector is running it flows; otherwise (the `dev` runtime, or observability off) the endpoint is
absent and nothing is emitted. Opt-in is the `telemetry` block in `manifest.json`. See
`docs/features/observability.md` in the Hosty Core platform repo (not this one).

## License

MIT
