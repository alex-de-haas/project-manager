# Project Manager

Project Manager is a Next.js application for planning releases, tracking work, recording time, and coordinating project teams. It supports local task management and optional Azure DevOps integration for teams that want to keep delivery planning in sync with work items.

## Overview

The application is organized around a few core workflows:

- **Time tracking**: weekly and monthly views, inline time entry editing, totals by day and work item, status filtering, and Excel export.
- **Work management**: local tasks and bugs, task status changes, checklists, blockers, and completion rules that prevent closing work with unfinished checklist items.
- **Release planning**: ordered releases, imported work items, child task visibility, release status tracking, and movement of work between releases.
- **Day-offs**: personal and team day-off tracking with full-day and half-day support.
- **Project administration**: email/password authentication, first-run admin setup, invitations, project switching, users, projects, and general settings.
- **Azure DevOps integration**: optional import, export, refresh, status sync, and release planning support for Azure DevOps work items.
- **Database operations**: local SQLite storage with backup and restore support.

## Tech Stack

- Next.js 14 with App Router
- TypeScript
- SQLite with `better-sqlite3`
- Tailwind CSS and Radix UI
- dnd-kit
- Sonner notifications
- Azure DevOps Node API
- ExcelJS

## Requirements

- Node.js 18 or newer
- npm

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` to configure session security and generated invitation links:

```bash
AUTH_SECRET=replace-with-strong-random-secret
APP_BASE_URL=http://localhost:3000
```

`AUTH_SECRET` is required for production. If it is missing in production, authentication fails closed; local development uses a development-only fallback.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first launch:

1. Go to `/login`.
2. Create the first admin user.
3. Continue into the app with the newly created account.

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

Use the Settings area in the app to manage database backups and restore from an existing backup.

## Docker

Build and run the app in Docker:

```bash
docker build -t project-manager .
docker run --rm -p 3000:3000 project-manager
```

## Documentation

Feature documentation lives in the `docs` folder:

- `docs/AZURE_DEVOPS_INTEGRATION.md`
- `docs/BLOCKERS_FEATURE.md`
- `docs/SETTINGS_FEATURE.md`
- `docs/SONNER_USAGE.md`

Documentation in `docs` should describe user-facing feature behavior and avoid detailed implementation notes.

## Task Tracking

Project work is tracked in the Notion page **Project Manager Tasks**.

## License

MIT
