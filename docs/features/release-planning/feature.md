---
created: 2026-05-30
updated: 2026-09-22
summary: Releases organize a project's user stories and their child tasks and bugs into trackable work.
---

# Release Planning

## Overview

Release Planning organizes project work into releases. Releases primarily contain user stories, and user stories can have child tasks or bugs that become trackable work for project members.

Release Planning requires an active Project Manager project. When no project exists or no project is selected, the page shows a project-required state and skips release and release-work-item requests.

## Release Items

Release membership is stored separately from work item identity. A release item links a release to a canonical work item and stores the release-specific display order.

Release items can reference:

- Local Project Manager user stories.
- Azure DevOps-linked user stories.
- Child tasks and bugs through the parent work item relationship.

## User Stories

User stories are Project Manager work items with type `user_story`. They are planning items and do not appear in Time Management.

Users can create local user stories from the release planner dialog. User story descriptions support Markdown and are stored on the canonical work item.

The Notes column shows the [work item note](../work-item-notes/feature.md), rendered as
Markdown. The note belongs to the work item rather than to the release item, so moving a
user story to another release keeps its note, and the same text is visible wherever the
work item appears.

Azure DevOps user story imports create or link local Project Manager user story records and attach them to the selected release. Imported user stories keep provider identity in `work_item_external_links`.

## Child Tasks And Bugs

Child tasks and bugs are separate Project Manager work items with a `parent_work_item_id` pointing to the user story. They are not title-prefix relationships.

Planning supports creating discipline-specific child tasks for backend, frontend, and design work. The user creating the child task can assign it to any project member, including non-admin members.

Imported Azure DevOps user stories automatically sync their open and closed child tasks and bugs. Child items are upserted as Project Manager work items with provider tags preserved for planning popups and task context. When the provider assignee maps to a Project Manager user, the child item is assigned locally for planning context. Assignment does not add the child item to Time Management; the user must explicitly add it from a Time Management flow before it appears in the time tracker. If the assignee cannot be mapped, the child item remains unassigned locally and keeps the provider assignee snapshot for display.

Child item popups list tasks before bugs and sort each group alphabetically by title.

## Refresh

Release Planning refresh updates linked provider user stories and fetches current child tasks and bugs. Refresh updates normalized Project Manager type and status, provider-native metadata, tags, and assignment snapshots.

## Blockers And Status

User story action buttons show a circular loading indicator while changing status, saving notes, preparing blockers, moving, or removing the item. Child task and bug action buttons show the same indicator while changing status or assignee, in both child-item dialogs. Busy buttons stay visible without hovering and cannot open their menus. Status, assignment, and blocker preparation requests are tracked per row, so concurrent requests on different rows retain separate indicators; completion or failure restores the affected button.

Blockers can be attached to any work item type. Release Planning exposes blockers for release items so blocked planning work is visible during release review.

Local status changes use Project Manager workflow gates. Status updates received from Azure DevOps refresh are accepted as provider state and stored with provider diagnostics, even if they would not have passed a local workflow gate.

## Bulk Release Operations

User story rows have selection checkboxes. The header checkbox selects all user
stories in the current release and displays a partial-selection indicator. Other
work item types retain their individual actions but cannot be selected for bulk
story operations. A selection toolbar shows the selected count, clear selection,
`Move to release`, and `Remove from release`.

Bulk moves offer other active releases in the current project. New releases are
created in Settings. Selected stories are appended in their source display order.
Bulk removal asks for confirmation and removes only the selected release
memberships; stories, notes, children, provider links, assignments, and tracked
time remain intact. Neither action changes Azure DevOps iterations or statuses.

Both operations are atomic. Missing or stale selections, cross-project items,
completed move destinations, and duplicate destination membership reject the
whole operation. Failures preserve the selection and display an error in the
dialog. Successful operations clear selection and reload the source release.
Pending operations disable repeat submissions and conflicting row actions,
reordering, imports, and refresh. Selection resets on release changes and project
reloads, and reconciles with reloaded rows. Stale bulk responses cannot overwrite
a different release view. When navigation occurs during a successful bulk operation,
the currently active release reloads after the operation commits; any older
in-flight navigation fetch is cancelled.

## Testing Expectations

- Saving a note from Release Planning updates the work item, including a work item that
  is linked to Azure DevOps.
- A note saved from Release Planning is scoped to the active project and cannot reach a
  work item in another project.
- Delayed user story status, child task/bug status, and child assignment requests show loading indicators until completion, restore actions on error, and prevent duplicate requests for the same row while allowing independent rows to update.
- Concurrent blocker preparation on different user stories keeps both rows busy independently and prevents duplicate preparation for a pending row.

- Bulk move tests verify source ordering, append ordering, project isolation,
  invalid and stale selections, completed destinations, duplicate membership,
  and unchanged canonical work item data and provider links.
- Bulk removal tests verify that only selected memberships are removed and that
  stories, notes, children, and membership in other releases remain intact.
- Database failures after an earlier write roll back every move or removal.
- Browser checks cover partial/all selection, keyboard operation, clear selection,
  move and removal dialogs, successful moves, retained selection on failure,
  release/project selection resets, and disabled controls during submission.
