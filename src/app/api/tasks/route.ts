export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Task, TimeEntry, TaskWithTimeEntries, Blocker } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';

interface ChecklistSummary {
  task_id: number;
  total: number;
  completed: number;
}

interface TimeEntryTotal {
  task_id: number;
  total_hours: number;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month'); // Format: YYYY-MM
    const startDateParam = searchParams.get('startDate'); // Format: YYYY-MM-DD
    const endDateParam = searchParams.get('endDate'); // Format: YYYY-MM-DD

    let startDate: string;
    let endDate: string;

    // Support both month parameter and explicit date range
    if (startDateParam && endDateParam) {
      startDate = startDateParam;
      endDate = endDateParam;
    } else if (month) {
      const [year, monthNum] = month.split('-');
      startDate = `${year}-${monthNum}-01`;
      endDate = `${year}-${monthNum}-31`;
    } else {
      return NextResponse.json({ error: 'Either month or startDate/endDate parameters are required' }, { status: 400 });
    }

    // Fetch tasks that overlap with the selected period
    // A task overlaps if:
    // - It was created before or during the period AND
    // - It was either not completed yet OR completed during or after the period start
    const tasks = db.prepare(`
      SELECT * FROM tasks 
      WHERE user_id = ?
        AND project_id = ?
        AND DATE(created_at) <= ?
        AND (completed_at IS NULL OR DATE(completed_at) >= ?)
      ORDER BY COALESCE(display_order, 999999), created_at ASC
    `).all(userId, projectId, endDate, startDate) as Task[];

    // Fetch time entries for the specified month
    const timeEntries = db.prepare(
      `SELECT te.*
       FROM time_entries te
       INNER JOIN tasks t ON t.id = te.task_id
       WHERE t.user_id = ? AND t.project_id = ? AND te.date >= ? AND te.date <= ?`
    ).all(userId, projectId, startDate, endDate) as TimeEntry[];

    // Fetch all active blockers
    const blockers = db.prepare(
      'SELECT * FROM blockers WHERE user_id = ? AND project_id = ? AND is_resolved = 0 ORDER BY task_id, created_at DESC'
    ).all(userId, projectId) as Blocker[];

    // Fetch checklist summary for all tasks
    const checklistSummaries = db.prepare(`
      SELECT 
        task_id,
        COUNT(*) as total,
        SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed
      FROM checklist_items
      WHERE user_id = ? AND project_id = ?
      GROUP BY task_id
    `).all(userId, projectId) as ChecklistSummary[];

    // Create a map of task_id to checklist summary
    const checklistMap = new Map<number, { total: number; completed: number }>();
    checklistSummaries.forEach(summary => {
      checklistMap.set(summary.task_id, {
        total: summary.total,
        completed: summary.completed,
      });
    });

    // Fetch all-time tracked hours so completion confirmation is not limited to the selected period.
    const timeEntryTotals = db.prepare(
      `SELECT te.task_id, SUM(te.hours) as total_hours
       FROM time_entries te
       INNER JOIN tasks t ON t.id = te.task_id
       WHERE t.user_id = ? AND t.project_id = ?
       GROUP BY te.task_id`
    ).all(userId, projectId) as TimeEntryTotal[];

    const timeEntryTotalMap = new Map<number, number>();
    timeEntryTotals.forEach((entry) => {
      timeEntryTotalMap.set(entry.task_id, entry.total_hours ?? 0);
    });

    // Combine tasks with their time entries, blockers, and checklist summary
    const tasksWithEntries: TaskWithTimeEntries[] = tasks.map(task => {
      const entries: Record<string, number> = {};
      
      timeEntries
        .filter(entry => entry.task_id === task.id)
        .forEach(entry => {
          entries[entry.date] = entry.hours;
        });

      const taskBlockers = blockers.filter(b => b.task_id === task.id);
      const checklistSummary = checklistMap.get(task.id);

      return {
        ...task,
        timeEntries: entries,
        totalHoursTracked: timeEntryTotalMap.get(task.id) ?? 0,
        blockers: taskBlockers,
        checklistSummary,
      };
    });

    return NextResponse.json(tasksWithEntries);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { title, type, userId: requestedUserId } = body;

    if (!title || !type) {
      return NextResponse.json(
        { error: 'Title and type are required' },
        { status: 400 }
      );
    }

    if (type !== 'task' && type !== 'bug') {
      return NextResponse.json(
        { error: 'Type must be either "task" or "bug"' },
        { status: 400 }
      );
    }

    let targetUserId = userId;
    if (requestedUserId !== undefined) {
      const parsedTargetUserId = Number(requestedUserId);
      if (!Number.isInteger(parsedTargetUserId) || parsedTargetUserId <= 0) {
        return NextResponse.json(
          { error: 'userId must be a positive integer' },
          { status: 400 }
        );
      }

      const isProjectMember = db
        .prepare('SELECT 1 as ok FROM project_members WHERE project_id = ? AND user_id = ?')
        .get(projectId, parsedTargetUserId) as { ok: number } | undefined;

      if (!isProjectMember) {
        return NextResponse.json(
          { error: 'Selected user is not assigned to this project' },
          { status: 400 }
        );
      }

      targetUserId = parsedTargetUserId;
    }

    // Get the current max display_order and add 1 for the new task
    const maxOrder = db
      .prepare('SELECT MAX(display_order) as max_order FROM tasks WHERE user_id = ? AND project_id = ?')
      .get(targetUserId, projectId) as { max_order: number | null };
    const newOrder = (maxOrder.max_order ?? -1) + 1;

    const result = db.prepare(
      'INSERT INTO tasks (user_id, project_id, title, type, display_order) VALUES (?, ?, ?, ?, ?)'
    ).run(targetUserId, projectId, title, type, newOrder);

    return NextResponse.json(
      { message: 'Task created successfully', id: result.lastInsertRowid },
      { status: 201 }
    );
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { id, status, title, type } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // Handle status update
    if (status !== undefined) {
      // Determine if status is a "completed" state
      const completedStatuses = ['closed', 'resolved', 'done', 'completed'];
      const isCompleted = completedStatuses.includes(status.toLowerCase());

      if (isCompleted) {
        const checklistSummary = db.prepare(
          `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed
           FROM checklist_items
           WHERE task_id = ? AND user_id = ? AND project_id = ?`
        ).get(id, userId, projectId) as { total: number; completed: number | null } | undefined;

        if (checklistSummary && checklistSummary.total > 0) {
          const completedCount = checklistSummary.completed ?? 0;
          if (completedCount < checklistSummary.total) {
            return NextResponse.json(
              { error: 'Cannot resolve or close a work item until all checklist items are completed.' },
              { status: 400 }
            );
          }
        }
      }
      
      // Get current task to check if status changed
      const currentTask = db
        .prepare('SELECT status FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
        .get(id, userId, projectId) as { status?: string | null } | undefined;
      
      if (!currentTask) {
        return NextResponse.json(
          { error: 'Task not found' },
          { status: 404 }
        );
      }

      const wasCompleted = currentTask.status ? completedStatuses.includes(currentTask.status.toLowerCase()) : false;
      
      // Update status and completed_at
      let result;
      if (isCompleted && !wasCompleted) {
        // Task is being completed - set completed_at to now
        result = db.prepare('UPDATE tasks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND project_id = ?').run(status, id, userId, projectId);
      } else if (!isCompleted && wasCompleted) {
        // Task is being reopened - clear completed_at
        result = db.prepare('UPDATE tasks SET status = ?, completed_at = NULL WHERE id = ? AND user_id = ? AND project_id = ?').run(status, id, userId, projectId);
      } else {
        // Status change doesn't affect completion - just update status
        result = db.prepare('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ? AND project_id = ?').run(status, id, userId, projectId);
      }

      if (result.changes === 0) {
        return NextResponse.json(
          { error: 'Task not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { message: 'Task updated successfully' },
        { status: 200 }
      );
    }

    // Handle title and type update
    if (title !== undefined || type !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];

      if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
      }

      if (type !== undefined) {
        if (type !== 'task' && type !== 'bug') {
          return NextResponse.json(
            { error: 'Type must be either "task" or "bug"' },
            { status: 400 }
          );
        }
        updates.push('type = ?');
        values.push(type);
      }

      values.push(id);
      values.push(userId);
      values.push(projectId);

      const result = db.prepare(
        `UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND user_id = ? AND project_id = ?`
      ).run(...values);

      if (result.changes === 0) {
        return NextResponse.json(
          { error: 'Task not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { message: 'Task updated successfully' },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: 'No valid update fields provided' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const taskId = searchParams.get('id');

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // Delete associated time entries first (cascade delete)
    db.prepare(`
      DELETE FROM time_entries
      WHERE task_id = ?
        AND task_id IN (SELECT id FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?)
    `).run(taskId, taskId, userId, projectId);
    
    // Delete the task
    const result = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?').run(taskId, userId, projectId);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Task deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to delete task' },
      { status: 500 }
    );
  }
}
