# Notifications Feature

## Overview

Project Manager uses toast notifications to provide immediate feedback after user actions. Notifications keep users informed without interrupting the current workflow.

## Notification Types

- **Success**: confirms that an action completed, such as saving settings or importing work items.
- **Error**: explains that an action failed and may include the reason.
- **Warning**: highlights a risky or blocked action, such as trying to close a task before checklist items are complete.
- **Info**: communicates neutral state changes or available updates.
- **Loading**: shows that a longer-running action is in progress.

## Where Notifications Appear

Notifications are used across workflows where immediate feedback matters:

- Task creation and updates.
- Checklist generation and checklist changes.
- Blocker creation, resolution, and deletion.
- Azure DevOps connection tests, imports, refreshes, exports, and status sync.
- Settings changes.
- User and project management.
- Database backup and restore operations.

## Behavior Guidelines

- Notifications should be short and action-oriented.
- Success messages should confirm the completed action.
- Error messages should help the user understand what to fix next.
- Loading messages should be used for actions that may take noticeable time.
- Notifications should not replace validation messages when the user needs to correct a specific field.

## User Experience

Notifications are intended to support focused work. They should confirm important outcomes, surface failures quickly, and avoid requiring users to leave the page they are working on.
