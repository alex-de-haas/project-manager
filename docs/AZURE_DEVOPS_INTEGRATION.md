# Azure DevOps Integration

## Overview

The Azure DevOps integration connects Project Manager with Azure DevOps work items. It is optional: teams can use Project Manager entirely with local tasks, or connect a project to Azure DevOps when they want planning and execution data to stay aligned.

## Capabilities

- Configure Azure DevOps organization, project, and Personal Access Token.
- Test the Azure DevOps connection before saving settings.
- Import work items assigned to the current user.
- Import specific work items by ID.
- Avoid duplicate imports for work items that are already linked.
- Show which tasks are linked to Azure DevOps.
- Refresh imported items to pick up title, type, and status changes.
- Update linked work item status from Project Manager when permissions allow it.
- Export local tasks to Azure DevOps.
- Link exported tasks to an optional parent work item.
- Import release work items for release planning.
- Track child work item counts and child status in release planning.
- Create discipline-specific child tasks for backend, frontend, and design work.
- Create a local blocker task from a release work item.

## Setup

1. Create a Personal Access Token in Azure DevOps.
2. Give the token access to work items.
3. Open Settings in Project Manager as a project owner or administrator.
4. Enter the Azure DevOps organization, project, and token.
5. Test the connection.
6. Save the settings after the test succeeds.

For status updates and exported tasks, the token needs work item write access. Read-only tokens can still support read-focused workflows such as import and refresh.

Saved tokens are treated as project-level secrets. Project owners and administrators can manage them; other project members can use the integration features without viewing or changing the token.

## Importing Work Items

Users can import all assigned work items or provide a specific list of work item IDs. Imported work items become tasks or bugs in Project Manager and keep a link to their Azure DevOps source.

Imported items can be used in time tracking, task lists, blockers, checklists, and release planning.

## Refreshing Work Items

Refresh updates previously imported work items with the latest Azure DevOps data. This is useful when titles, types, or statuses change outside Project Manager.

## Status Sync

When a task is linked to Azure DevOps, status changes can sync back to the Azure DevOps work item. If the token does not have write permissions or the target status is not valid for the work item process, the local task can still be updated while the remote update fails.

## Release Planning

Release planning can import Azure DevOps user stories and related work items into a release. Teams can reorder releases, move work items between releases, review child work item progress, and create supporting child tasks for different disciplines.

## Troubleshooting

### Connection Fails

- Check that the organization and project names match Azure DevOps.
- Confirm that the token has not expired.
- Confirm that the token has work item permissions.
- Verify that the user can access the target project in Azure DevOps.

### No Work Items Are Found

- Confirm that relevant work items are assigned to the expected user.
- Check that manually entered work item IDs are correct.
- Verify that the token can read those work items.

### Status Updates Fail

- Confirm that the token has work item write permissions.
- Check whether the selected status exists in the Azure DevOps process used by the project.
- Review whether the work item is in a state that allows the requested transition.
