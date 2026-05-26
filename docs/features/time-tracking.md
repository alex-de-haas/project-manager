# Time Tracking

## Description

Time tracking shows weekly and monthly work item rows for the active project. Users can enter time inline for work items assigned to them, review totals by day and work item, filter by status, and export monthly time to Excel.

When the user clicks **Refresh**, rows assigned to another project member are shown when they have no tracked time recorded. These rows are highlighted with a warning icon and assignee tooltip so project members can spot untracked delegated work without editing another user's time.

## Behavior

- Current-user work items remain editable in the time grid.
- Work items assigned to another user are read-only in the time grid.
- Other-user work items are checked when Refresh runs and are only surfaced in this warning state when no all-time tracked time exists for the work item.
- Completed work items with no period time remain hidden unless they are in the other-user untracked warning state and their status filter is enabled.
