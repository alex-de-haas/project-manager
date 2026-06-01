# Azure DevOps Integration

## Overview

The Azure DevOps integration connects Project Manager work items with Azure DevOps work items. The integration is optional. Teams can run Project Manager with local work only, or connect a project to Azure DevOps when provider synchronization is needed.

Project Manager remains the local source of truth for its own work item records. Azure DevOps identity, native state, native type, assignee snapshots, and sync diagnostics are stored on provider link records.

## Capabilities

- Configure Azure DevOps as a project-level integration.
- Store each user's Azure DevOps Personal Access Token separately for each Project Manager project.
- Resolve the project-specific Azure DevOps identity represented by each user's PAT.
- Store technical provider identity fields for assignment mapping.
- Show the active project's linked Azure DevOps account without renaming the Docker Host user.
- Import assigned tasks and bugs into Time Management.
- Import specific work items by ID.
- Import user stories into Release Planning.
- Refresh linked work items from Azure DevOps.
- Upsert child tasks and bugs for imported user stories.
- Map Azure DevOps assignees to Project Manager users when provider identities are known.
- Export local tasks and bugs to Azure DevOps, including Markdown descriptions.
- Export creates Azure DevOps work items first, then applies the current Project Manager status in a separate state update so process rules can run on the newly created work item.
- Synchronize local status and assignment changes back to Azure DevOps when permissions and process rules allow it.
- Preserve local status changes and mark sync failures when Azure DevOps updates fail.

## Setup

1. Create a Personal Access Token in Azure DevOps.
2. Give the token access to work items.
3. Open Settings in Project Manager as a Docker Host administrator.
4. Create or edit a Project Manager project.
5. Select Azure DevOps as the project integration.
6. Enter the Azure DevOps project URL, such as `https://dev.azure.com/{organization}/{project}`.
7. Open Profile and save the current user's personal token.
8. Test the connection.

For status updates and exported work items, the token needs work item write access. Read-only tokens can still support read-focused workflows such as import and refresh.

Saved tokens are project-scoped personal credentials. Project Manager stores each Host user's Azure DevOps PAT separately for each Project Manager project and uses only the current Host user's PAT for the active project during import, export, refresh, status synchronization, and assignment synchronization. API responses never expose the PAT value. Profile responses expose only the active project's saved-link status and the resolved non-secret Azure DevOps name and email for the current user.

When a PAT is saved, Project Manager immediately resolves the Azure DevOps identity represented by that token for the active project. Technical identity fields are stored by project, provider, and user for assignment mapping. Profile shows the resolved name and email for the active project. If Azure DevOps only returns an account or email, Profile falls back to the Docker Host name for the display line while still showing the Azure DevOps email separately. The Docker Host user name is not changed. Later import, refresh, status-sync, and assignment-sync flows use the stored active-project identity for matching instead of resolving the PAT user on every request. Runtime identity resolution remains only as a fallback for project identity records that do not have a stored provider identity yet.

## Type Mapping

Azure DevOps work item types are mapped into Project Manager types:

- User Story maps to `user_story`.
- Task maps to `task`.
- Bug maps to `bug`.

Provider-native type is preserved on the provider link for diagnostics and display. Project Manager behavior uses the normalized Project Manager type.

## Status Mapping

Azure DevOps states are mapped into Project Manager normalized statuses:

- New-like provider states map to `new`.
- Active-like provider states map to `in_progress`.
- Resolved-like provider states map to `resolved`.
- Closed, Done, Completed, or Removed-like provider states map to `completed`.

Provider-native status is preserved separately on the provider link. This allows Project Manager to display and debug provider state without coupling local workflow rules to one Azure DevOps process.

## Importing Work Items

Assigned imports use Azure DevOps WIQL with the `@Me` macro, so Azure DevOps resolves the assignee from the PAT-authenticated request identity. Import does not depend on the Project Manager user's email address.

Imported tasks and bugs are assigned to the current Project Manager user and can appear in Time Management. Imported user stories are attached to releases and do not appear in Time Management.

Project Manager prevents duplicate provider imports by enforcing uniqueness on project, provider, and external work item id.

## Release Planning

Release Planning imports Azure DevOps user stories as Project Manager `user_story` work items. During import and refresh, Project Manager also fetches child tasks and bugs and upserts them as separate Project Manager work items with `parent_work_item_id` pointing to the user story.

If a child task or bug has an Azure DevOps assignee that maps to a Project Manager user, the child item is assigned locally and can appear in that user's Time Management page. If no mapping exists, the child item remains unassigned locally and the provider assignee snapshot remains visible for planning context.

When Project Manager syncs child tasks and bugs through a user's Azure DevOps PAT, it also checks the child work item ids against Azure DevOps `@Me`. This protects assignment mapping when `System.AssignedTo` contains only a display name and does not include a stable id or email address.

Manual child assignment from Release Planning updates Azure DevOps first and then updates the local Project Manager assignment. If Azure DevOps rejects the assignment or the target Project Manager user has not linked an Azure DevOps account for the active project, the local assignment is not changed.

## Status Sync

When a linked work item status changes locally, Project Manager validates the local workflow gate first. If the local transition passes, the local status is saved and Azure DevOps synchronization is attempted.

If Azure DevOps rejects the update or the token lacks write access, the local change remains saved. The work item and provider link are marked as `sync_failed`, and the last sync error is stored without logging secrets.

## Provider Sync Disablement

Administrators can disable provider sync for a project. Existing provider links are preserved as historical metadata, but refresh, export, and status sync stop using those links while sync is disabled.

Project Manager blocks switching from one configured provider to a different provider while provider-linked work items exist. A future migration or cleanup flow would be required before changing providers.

## Troubleshooting

### Connection Fails

- Check that the saved project URL opens the intended Azure DevOps project.
- Confirm that the token has not expired.
- Confirm that the token has work item permissions.
- Verify that the user can access the target project in Azure DevOps.
- Confirm that the current Project Manager user has linked an Azure DevOps account in Profile for the active project.

### No Work Items Are Found

- Confirm that relevant work items are assigned to the Azure DevOps user shown by the connection test for the active project's saved link.
- Check that manually entered work item IDs are correct.
- Verify that the token can read those work items.

### Status Updates Fail

- Confirm that the token has work item write permissions.
- Check whether the selected status exists in the Azure DevOps process used by the project.
- Review whether the work item is in a state that allows the requested transition.
- Review the Project Manager sync failure indicator for the latest local error message.
