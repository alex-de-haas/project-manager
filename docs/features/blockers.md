# Blockers

Created: 2026-05-23
Updated: 2026-06-12

## Overview

Blockers make blocked work visible without changing the work item itself. A blocker records what is stopping progress, how severe the issue is, and whether it has been resolved.

Blockers attach to canonical Project Manager work items. They can be used with user stories, tasks, and bugs.

## Capabilities

- Add one or more blockers to a work item.
- Assign a severity level: low, medium, high, or critical.
- Highlight blocked rows based on the highest active severity.
- Resolve blockers with an optional resolution note.
- Reopen resolved blockers when an issue becomes active again.
- Delete blockers that are no longer relevant.
- Keep active and resolved blockers separated in the blocker dialog.

## Workflow Gates

Active blockers participate in local status validation:

- Tasks cannot enter the completed state while active blockers exist.
- Bugs cannot enter the resolved state while active blockers exist.
- User stories cannot enter the resolved state while active blockers exist.

Provider refreshes can still record provider statuses that bypass local gates. Those provider-driven updates are stored with sync diagnostics so the team can correct blockers or checklist state locally.

## Typical Workflow

1. Open the blocker dialog from a work item row.
2. Add a short comment describing the blocking issue.
3. Choose the severity.
4. Resolve the blocker when the issue is cleared.
5. Add a resolution note when the outcome needs to be visible later.

## Severity Guidance

- **Low**: a minor impediment that does not materially change delivery expectations.
- **Medium**: a visible impediment that needs attention but has a workaround.
- **High**: a serious issue that can delay the work item or related work.
- **Critical**: a blocking issue that requires immediate attention before work can continue.

## Relationship To Work Items

Blockers provide delivery context and prioritization signals. The work item remains the source of ownership, status, checklist, description, provider link, and time tracking information.
