# Time Tracking

## Description

Time tracking shows weekly and monthly work item rows for the active project. Users can enter time inline for their local work items, review totals by day and work item, filter by status, refresh visible imported Azure DevOps items, and export monthly time to Excel.

When the user clicks **Refresh**, Project Manager checks only Azure DevOps work items currently visible on the time-management page for the selected week or month. Release-planning-only user stories are not included. Refresh stores the latest Azure DevOps assignee snapshot on each refreshed task; after refresh or status sync, rows that Azure DevOps reports as assigned to someone other than the current PAT-authenticated user are omitted from the time grid.

## Behavior

- Current-user local work items remain editable in the time grid.
- Refresh updates title, type, status, tags, completion date, and current Azure DevOps assignee metadata for visible imported Azure DevOps tasks in the active period.
- Time tracking refresh does not read release planning work items and does not surface unrelated project tasks owned by other users.
- Azure DevOps tasks known to be assigned away from the current PAT-authenticated user are hidden from the time grid.
- Expected-hour calculations use the current user's profile work schedule for the active project. Missing schedules use the module-level `PROJECT_MANAGER_DEFAULT_DAY_LENGTH` environment value, which defaults to 8 hours.
- Completed work items with no period time remain hidden.
