![Project Manager](../assets/icon.svg)

# Project Manager

A Hosty runtime app for **planning releases, tracking work, recording time, and
coordinating project teams**. It works standalone with local task management and adds
optional **Azure DevOps** integration for teams that keep delivery planning in sync with
work items.

## What it does

- **Time tracking** — weekly and monthly views, inline entry editing, totals by day and
  work item, status filtering, untracked-delegated-work warnings, and Excel export.
- **Work management** — local tasks and bugs, status changes, checklists, and blockers,
  with completion rules that prevent closing work with unfinished checklist items.
- **Release planning** — ordered releases, imported work items, child-task visibility,
  release status tracking, and moving work between releases.
- **Days off** — personal and team day-off tracking with full-day and half-day support.
- **Project administration** — Hosty identity, host-admin settings, project switching,
  and per-project user access.
- **Azure DevOps integration** — optional import, export, refresh, status sync, and
  release-planning support for Azure DevOps work items.

## Data

Local **SQLite** storage in a Hosty-managed app data directory, with JSON-migration
import plus backup and restore.

## Using it

Install from the marketplace and open it from the sidebar. The app is Hosty-only — Core
opens it with a short-lived authorization code and the app revalidates identity for
server-rendered pages and same-origin API calls. Configure Azure DevOps from Settings if
you want work-item sync.
