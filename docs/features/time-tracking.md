# Time Tracking

## Overview

Time Management shows weekly and monthly trackable work items for the active project. Users can enter time inline, review totals, filter by status, manage blockers and checklists, refresh linked provider items, and export monthly time to Excel.

Only Project Manager `task` and `bug` work items appear in time tracking. `user_story` work items are reserved for release planning and are excluded from time entry editing and time export.

## Work Items

Users can create local tasks and bugs from a dialog. Work item descriptions support Markdown and are stored on the canonical work item record.

Trackable work item rows include:

- Project Manager type: task or bug.
- Normalized status displayed with user-friendly labels.
- Optional Markdown description preview.
- Optional tags from provider metadata.
- Checklist progress when checklist items exist.
- Active blocker count and highest-severity blocker highlighting.
- Linked provider metadata when the item is synchronized with Azure DevOps.

## Time Entries

Time entries are stored by work item, user, and date. A user can edit time for work items assigned to them in the active project.

Expected-hour calculations use the current user's profile work schedule for the active project. Missing schedules use the module-level `PROJECT_MANAGER_DEFAULT_DAY_LENGTH` environment value, which defaults to 8 hours.

Completed work items with no period time remain hidden from the grid so old closed work does not clutter current tracking.

## Refresh

When the user clicks **Refresh**, Project Manager refreshes only linked Azure DevOps work items currently visible on the Time Management page for the selected week or month.

Refresh updates:

- Title.
- Project Manager type and status.
- Provider-native type and status.
- Tags.
- Completion date.
- Provider assignee snapshot.

Time Management refresh does not read release-planning-only user stories and does not surface unrelated project work owned by other users. If Azure DevOps reports a refreshed task or bug as assigned to someone other than the current PAT-authenticated user, Project Manager records that assignee snapshot and omits the row from the current user's time grid.

## Status Changes

Local status changes use Project Manager workflow gates. For example, a task cannot be completed while it still has active blockers or incomplete checklist items.

When a work item is linked to Azure DevOps, Project Manager first validates and saves the local status change. Provider synchronization is then attempted as a side effect. If provider sync fails, the local change remains saved and the work item is marked with a sync failure state.

## Export

Monthly Excel export includes time entries for trackable work items only. User stories are not exported as time rows.
