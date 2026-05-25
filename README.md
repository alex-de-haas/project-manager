# Project Manager

Project Manager is a Docker Host module for planning releases, tracking work, recording time, and coordinating project teams. It supports local task management and optional Azure DevOps integration for teams that want to keep delivery planning in sync with work items.

## Overview

The application is organized around a few core workflows:

- **Time tracking**: weekly and monthly views, inline time entry editing, totals by day and work item, status filtering, and Excel export.
- **Work management**: local tasks and bugs, task status changes, checklists, blockers, and completion rules that prevent closing work with unfinished checklist items.
- **Release planning**: ordered releases, imported work items, child task visibility, release status tracking, and movement of work between releases.
- **Day-offs**: personal and team day-off tracking with full-day and half-day support.
- **Project administration**: Docker Host identity, module administrator roles, project switching, projects, and general settings.
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
- Docker Host for authenticated module access

## Setup

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Link the running app into Docker Host developer mode:

```bash
docker-host dev up --manifest .docker-host/dev.json
```

If Docker Host is already running on a specific local URL, pass it explicitly:

```bash
docker-host dev up --manifest .docker-host/dev.json --host-url http://localhost:<host-port>
```

The application is host-only. In the Docker Host shell, browser UI runs from the module's direct origin and receives a signed Host identity token through the Host `postMessage` bridge. The module exchanges that token at `/api/auth/bootstrap` for a short-lived HttpOnly cookie used by server-rendered pages and same-origin API calls. Gateway and service/API traffic can still use the signed `X-Docker-Host-Identity` header.

Direct API requests without Docker Host identity return `401`, except for `/api/health` and `/api/auth/bootstrap`. Direct browser requests without identity render only the identity bootstrap state.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Data

- Main database: `data/time_tracker.db`
- Backups: `data/backups/*.db`

Use the Settings area in the app to import supported Project Manager migration JSON, manage database backups, and restore from an existing backup.

## Docker

Build the app image:

```bash
docker build -t project-manager .
```

The source module metadata template is available in `metadata.json`. CI renders an installable metadata file that points at the immutable `sha-<commit>` image tag pushed to GHCR, then publishes that file as the `metadata.json` asset on the `latest` GitHub release. The stable Docker Host metadata URL is:

```text
https://github.com/alex-de-haas/project-manager/releases/download/latest/metadata.json
```

Persistent state is stored under `/app/data` and is intended to be mounted from Docker Host-managed module storage.

## Documentation

Feature documentation lives in the `docs` folder:

- `docs/azure-devops-integration.md`
- `docs/blockers-feature.md`
- `docs/docker-host-module.md`
- `docs/settings-feature.md`
- `docs/sonner-usage.md`

Documentation in `docs` should describe user-facing feature behavior and avoid detailed implementation notes.

## Task Tracking

Project work is tracked in the Notion page **Project Manager Tasks**.

## License

MIT
