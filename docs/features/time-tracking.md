# Time Tracking

## Description

Time tracking shows weekly and monthly work item rows for the active project. Users can enter time inline for their local work items, review totals by day and work item, filter by status, refresh imported Azure DevOps items, and export monthly time to Excel.

When the user clicks **Refresh**, Project Manager checks only Azure DevOps work items that the current user already imported into the active period. If an imported, non-completed work item is no longer assigned to the current PAT-authenticated Azure DevOps user, the row is highlighted with a warning icon and assignee tooltip. This helps users spot work that was reassigned directly in Azure DevOps after it had already been imported locally.

## Behavior

- Current-user local work items remain editable in the time grid.
- Refresh updates title, type, status, tags, completion date, and current Azure DevOps assignee metadata for imported Azure DevOps tasks in the active period.
- Assignment mismatch warnings are scoped to the current user's imported Azure DevOps tasks. Refresh does not surface unrelated project tasks owned by other users.
- Completed work items with no period time remain hidden.
