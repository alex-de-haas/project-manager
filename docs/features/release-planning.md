# Release Planning

Created: 2026-05-30
Updated: 2026-06-12

## Overview

Release Planning organizes project work into releases. Releases primarily contain user stories, and user stories can have child tasks or bugs that become trackable work for project members.

Release Planning requires an active Project Manager project. When no project exists or no project is selected, the page shows a project-required state and skips release and release-work-item requests.

## Release Items

Release membership is stored separately from work item identity. A release item links a release to a canonical work item and stores release-specific order and notes.

Release items can reference:

- Local Project Manager user stories.
- Azure DevOps-linked user stories.
- Child tasks and bugs through the parent work item relationship.

## User Stories

User stories are Project Manager work items with type `user_story`. They are planning items and do not appear in Time Management.

Users can create local user stories from the release planner dialog. User story descriptions support Markdown and are stored on the canonical work item.

Azure DevOps user story imports create or link local Project Manager user story records and attach them to the selected release. Imported user stories keep provider identity in `work_item_external_links`.

## Child Tasks And Bugs

Child tasks and bugs are separate Project Manager work items with a `parent_work_item_id` pointing to the user story. They are not title-prefix relationships.

Planning supports creating discipline-specific child tasks for backend, frontend, and design work. The user creating the child task can assign it to any project member, including non-admin members.

Imported Azure DevOps user stories automatically sync their open and closed child tasks and bugs. Child items are upserted as Project Manager work items with provider tags preserved for planning popups and task context. When the provider assignee maps to a Project Manager user, the child item is assigned locally for planning context. Assignment does not add the child item to Time Management; the user must explicitly add it from a Time Management flow before it appears in the time tracker. If the assignee cannot be mapped, the child item remains unassigned locally and keeps the provider assignee snapshot for display.

Child item popups list tasks before bugs and sort each group alphabetically by title.

## Refresh

Release Planning refresh updates linked provider user stories and fetches current child tasks and bugs. Refresh updates normalized Project Manager type and status, provider-native metadata, tags, and assignment snapshots.

## Blockers And Status

Blockers can be attached to any work item type. Release Planning exposes blockers for release items so blocked planning work is visible during release review.

Local status changes use Project Manager workflow gates. Status updates received from Azure DevOps refresh are accepted as provider state and stored with provider diagnostics, even if they would not have passed a local workflow gate.
