# Project Manager

Project Manager is a Next.js application for time tracking, release planning, and team execution workflows with optional Azure DevOps integration.

## What Is Implemented

### Time Tracking
- Week and month grid views
- Inline editing of time entries
- Totals by day and by work item
- Drag-and-drop task ordering
- Status filtering (New, Active, Resolved, Closed)
- Excel export of current month (`/api/export`)

### Work Item Management
- Local tasks and bugs
- Status updates with completion date handling
- Task-level blockers with severity, resolved state, and optional resolution comments
- Task checklists with drag-and-drop ordering
- AI-generated checklist items (via LM Studio)
- Rule: task cannot be resolved/closed while checklist has incomplete items

### Day-Offs
- Personal day-offs with full-day or half-day mode
- Single-date and date-range creation
- Team day-off calendar page (`/day-offs`)
- Day-offs are included in expected-hours calculations

### Release Planner
- Release list with status (`active` / `completed`) and drag-and-drop ordering
- Import Azure DevOps user stories into releases
- Move work items between releases
- Remove work items from release
- Per-work-item status sync to Azure DevOps
- Create local blocker task from a release work item
- Child work item support (task/bug counts, status sync)
- Create discipline-specific child tasks (`BE:`, `FE:`, `Design:`) assigned to project users

### Azure DevOps Integration
- Settings stored per project (`organization`, `project`, `PAT`)
- Import assigned work items to time tracking
- Export local tasks to Azure DevOps (optional parent link)
- Refresh imported tasks/work items from Azure DevOps
- Bi-directional status updates for linked work items

### Auth, Users, and Projects
- Email/password login
- First-run bootstrap flow at `/login` (creates first admin user)
- User invitations with one-time token (`/invite`)
- Password change endpoint
- Multi-project support with project membership
- Project switcher in sidebar
- User and project management in Settings

### Database Operations
- SQLite auto-initialization and schema migrations
- Backup list/create/delete (`/api/database/backups`)
- Restore from backup (`/api/database/restore`)
- Backups stored in `data/backups/`

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- SQLite (`better-sqlite3`)
- Tailwind CSS + Radix UI
- dnd-kit
- Sonner toasts
- Azure DevOps Node API
- ExcelJS

## Requirements

- Node.js 18+

## Environment Variables

Create `.env.local` (optional but recommended):

```bash
# Required for production/session security
AUTH_SECRET=replace-with-strong-random-secret

# Optional: used when generating invitation links
APP_BASE_URL=http://localhost:3000
```

If `AUTH_SECRET` is not set, the app falls back to a local development secret.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first launch:
1. Go to `/login`
2. Create the first user (admin)
3. You will be logged in automatically

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Data Location

- Main DB: `data/time_tracker.db`
- Backups: `data/backups/*.db`

## API Surface (High-Level)

- Auth: `/api/auth/*`
- Tasks/time: `/api/tasks*`, `/api/time-entries`
- Day-offs: `/api/day-offs`
- Blockers: `/api/blockers`
- Checklist: `/api/checklist`, `/api/checklist/generate`
- Settings: `/api/settings`
- Users/projects: `/api/users`, `/api/projects`
- Releases: `/api/releases*`, `/api/releases/work-items*`
- Azure DevOps: `/api/azure-devops/*`
- Database backups/restore: `/api/database/*`
- Excel export: `/api/export`
- LM Studio connectivity test: `/api/lm-studio/test`

## Docker

Build and run:

```bash
docker build -t project-manager .
docker run --rm -p 3000:3000 project-manager
```

## Additional Docs

- `docs/AZURE_DEVOPS_INTEGRATION.md`
- `docs/BLOCKERS_FEATURE.md`
- `docs/SETTINGS_FEATURE.md`
- `docs/SONNER_USAGE.md`

## License

MIT
