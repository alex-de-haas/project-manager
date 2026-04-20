# Blocker Feature

## Overview
The blocker feature allows users to track issues that are blocking work items from progressing. Each blocker has a comment describing the issue and a severity level that determines visual highlighting.

## Features

### Blocker Properties
- **Comment**: Description of what is blocking the task
- **Resolution Comment**: Optional note added when the blocker is resolved
- **Severity Levels**: 
  - Low (Blue highlight)
  - Medium (Yellow highlight)
  - High (Orange highlight)
  - Critical (Red highlight)
- **Status**: Blockers can be marked as resolved or active

### Visual Indicators
Tasks with active blockers are highlighted in the task list:
- **Critical**: Red background
- **High**: Orange background
- **Medium**: Yellow background
- **Low**: Blue background

The highest severity blocker determines the task's highlight color.

### Task Row Indicators
Each task shows a "Blockers" button that displays:
- The word "Blockers" for tasks with no active blockers
- A 🚫 icon and count for tasks with active blockers (e.g., "🚫 2")

## Usage

### Adding a Blocker
1. Click the "Blockers" button on any task row
2. In the modal, enter a comment describing the blocker
3. Select the severity level (Low, Medium, High, or Critical)
4. Click "Add Blocker"

### Managing Blockers
In the Blockers Modal:
- **Edit**: Modify the comment or severity of an existing blocker
- **Resolve**: Mark a blocker as resolved and optionally add a resolution comment (moves to "Resolved Blockers" section)
- **Unresolve**: Reactivate a resolved blocker
- **Delete**: Permanently remove a blocker

### Visual Organization
The modal organizes blockers into two sections:
1. **Active Blockers**: Currently blocking the task
2. **Resolved Blockers**: Historical blockers that have been resolved

## Database Schema

```sql
CREATE TABLE blockers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  comment TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  is_resolved INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  resolution_comment TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CHECK(severity IN ('low', 'medium', 'high', 'critical'))
);
```

## API Endpoints

### GET /api/blockers
- Query param: `taskId` (optional) - Filter blockers by task
- Returns: Array of blockers

### POST /api/blockers
- Body: `{ task_id, comment, severity }`
- Creates a new blocker

### PATCH /api/blockers
- Body: `{ id, comment?, severity?, is_resolved?, resolution_comment? }`
- Updates an existing blocker

### DELETE /api/blockers
- Query param: `id` - Blocker ID to delete
- Deletes a blocker

## Integration with Tasks

The task list API (`/api/tasks`) automatically includes active blockers for each task. This data is used to:
1. Calculate the highest severity blocker per task
2. Apply appropriate visual highlighting
3. Display the blocker count badge
