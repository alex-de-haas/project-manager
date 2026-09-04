# Work Item Notes

Created: 2026-09-04
Updated: 2026-09-04

## Overview

A work item note is free-form internal context attached to a work item: implementation
details, dependencies, risks, or anything a member wants to keep next to the item. It is
local to Project Manager and no integration ever reads or writes it.

The note lives on the canonical work item, so it is shared by every member of the
project and stays with the item across releases and across pages.

## Storage

`work_items.notes` holds one note per work item, for every work item type. A note that is
saved as blank or whitespace is stored as `NULL`, so an empty note is indistinguishable
from no note.

## Editing

`PATCH /api/work-items/notes` takes a `workItemId` and the note text and updates the work
item in the active project. The endpoint requires project membership and scopes the update
by project, so a note cannot be written to a work item in another project. It does not
require the work item to be assigned to the caller or to appear in the caller's Time
Management list, because Release Planning edits notes on user stories that belong to no
one in particular.

The note is editable on work items linked to Azure DevOps. Title, type and description are
provider-owned for such items and stay read-only; the note is not.

## Surfaces

- [Release Planning](../release-planning/feature.md) shows the note in the Notes column of
  the release table, rendered as Markdown, and edits it from the row menu.
- [Time Tracking](../time-tracking/feature.md) previews the note in a hover card behind a
  badge on the work item row, and edits it from the row menu.

Both surfaces render the note with the shared Markdown renderer, which supports headings,
emphasis, inline code, fenced code blocks, ordered and unordered lists, block quotes, and
`http`, `https` and `mailto` links.

## Integration Boundary

The note is never included in an [Azure DevOps](../azure-devops-integration/feature.md)
request. Export builds its create patch document from the title, description, assignee and
parent link only, and status and assignment sync touch nothing else.

## Testing Expectations

- A note saves, updates and clears through the endpoint, including on a work item linked
  to Azure DevOps and on a user story that Time Management never lists.
- Blank or whitespace note text clears the note.
- A note that is not a string, and a request without a work item id, are rejected.
- A note cannot be written to a work item outside the active project.
- The Azure DevOps create patch document never carries the note.
