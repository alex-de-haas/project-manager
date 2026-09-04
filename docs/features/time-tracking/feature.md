# Time Tracking

Created: 2026-05-26
Updated: 2026-09-04

## Overview

Time Management shows weekly and monthly trackable work items that the user has explicitly added to Time Management for the active project. Users can enter time inline, review totals, filter by status, manage blockers and checklists, refresh linked provider items, and export monthly time to Excel.

Only Project Manager `task` and `bug` work items can be added to time tracking. Azure DevOps Time Management import also lists only Tasks and Bugs. `user_story` work items are reserved for release planning and are excluded from import, time entry editing, and time export.

## Work Items

Users can create local tasks and bugs from a dialog. Work item descriptions support Markdown and are stored on the canonical work item record.

Time Management membership is stored separately from the canonical work item. A task or bug can exist in Project Manager as planning context without appearing in Time Management. The row appears only after a user creates it from Time Management, imports it through the Time Management import dialog, imports time entries for it, or otherwise creates a per-user Time Management membership record.

Trackable work item rows include:

- Project Manager type: task or bug.
- Normalized status displayed with user-friendly labels.
- Optional Markdown description preview.
- Optional [work item note](../work-item-notes/feature.md) preview.
- Optional tags from provider metadata.
- Checklist progress when checklist items exist.
- Active blocker count and highest-severity blocker highlighting.
- Linked provider metadata when the item is synchronized with Azure DevOps.

## Notes

The row menu opens an Add note or Edit note dialog for the work item note, and a badge
beside the description badge previews the saved note as rendered Markdown. Unlike title,
type and description, the note stays editable on Azure DevOps-linked rows, because it is
local context that no integration reads or writes.

## Import

The Time Management import dialog has a shared search and status filter for all import sources. The default status filter includes New and Active work items. Users can also include Resolved and Closed work items when they need to add completed work.

When the active project and current user have Azure DevOps configured, the dialog opens on the Azure DevOps tab and searches assigned Azure DevOps Tasks and Bugs. The Backlog tab is always available and lists local Project Manager tasks and bugs from `work_items` that have not yet been added to the current user's Time Management list.

## Time Entries

Time entries are stored by work item, user, and date. A user can edit time for work items assigned to them in the active project after the item has been added to that user's Time Management list.

Expected-hour calculations use the current user's profile work schedule for the active project. Missing schedules use the app-level `PROJECT_MANAGER_DEFAULT_DAY_LENGTH` environment value, which defaults to 8 hours.

Completed work items with no period time remain hidden from the grid so old closed work does not clutter current tracking.

## Overtime Balance

The grid footer shows the tracked total for each day and, below it, the running overtime balance as of that day. The balance is cumulative and continues across periods: the first day of a week or month starts from the balance carried in from every earlier tracked day rather than from zero. A header chip states the carried-in balance for the displayed period.

The balance is `tracked hours - expected hours` over every day from the user's first tracked day in the active project up to, but not including, the displayed period. Tracked hours count hours logged on any day, so work on a weekend or a day off becomes surplus. Expected hours count business days at the profile day length, minus full days off and half of each half day off; days off that fall on a weekend change nothing because the expectation there is already zero.

Days before the user's first tracked day in the project contribute nothing either, so a period that ends before any time was tracked shows no deficit, and the period holding the first tracked day starts counting from that day. Days in the future contribute nothing to the balance. A period that has not started yet therefore carries the balance as of today instead of a deficit for days nobody could have tracked, and the running figure stays hidden on future days, weekends and full days off.

The balance is scoped to the active project, matching the grid above it. Days off are stored per user rather than per project, so a user who tracks time on two projects has the same absence deducted in both.

The day length has no history: `default_day_length` holds one current value per user and project, so changing it re-prices every past day and shifts the whole balance. There is no balance start date and no manual adjustment — a wrong balance is corrected by fixing the underlying time entries.

Computing the balance never loads historical time entries into the browser. One request per period start returns a single aggregated scalar, and the day count behind the expectation is arithmetic rather than a walk over the calendar, so the cost does not grow with the length of the history.

## Refresh

When the user clicks **Refresh**, Project Manager refreshes only linked Azure DevOps work items currently visible on the Time Management page for the selected week or month.

Refresh updates:

- Title.
- Project Manager type and status.
- Provider-native type and status.
- Tags.
- Completion date.
- Provider assignee snapshot.
- Local assignment when a refreshed Azure DevOps assignee maps to a Project Manager user.

Time Management refresh does not read release-planning-only user stories and does not surface unrelated project work owned by other users. If Azure DevOps reports a refreshed task or bug as assigned to someone other than the current PAT-authenticated user, Project Manager records that assignee snapshot. If the assignee does not map to a Project Manager user, the local assignment is cleared while the Azure DevOps assignee name remains visible with an external-assignee indicator.

Rows assigned away in Azure DevOps remain visible to the current user only when the selected week or month contains that user's tracked time. This keeps historical reporting and monthly export accurate after a handoff to a user who does not exist in Project Manager yet.

## Status Changes

Local status changes use Project Manager workflow gates. For example, a task cannot be completed while it still has active blockers or incomplete checklist items.

When a work item is linked to Azure DevOps, Project Manager first validates and saves the local status change. Provider synchronization is then attempted as a side effect. If provider sync fails, the local change remains saved and the work item is marked with a sync failure state.

## Export

Monthly Excel export includes Time Management work items for the current user only. User stories and project tasks or bugs that have not been added to the user's Time Management list are not exported as time rows.

Only work items with tracked time in the exported period are included. A task or bug that overlaps the period but holds no hours in it is left out regardless of status, so the sheet never carries zero rows.

## Testing Expectations

- Business-day counting over ranges that start or end on a weekend, cross month and year boundaries, or are empty.
- Expected hours with full days off, half days off, and days off that fall on a weekend.
- Balance range resolution for a past period, a period that starts in the future, and a user with no tracked history.
- Balance arithmetic for an empty history, weekend-only work, and a deficit.
- Saving a note from Time Management updates the work item, including a work item that
  is linked to Azure DevOps, and clearing the text removes the note.
