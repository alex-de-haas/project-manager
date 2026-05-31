export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from '@/lib/user-context';
import { getWorkItemForUser } from '@/lib/work-items';

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { task_id, work_item_id, date, hours } = body;
    const workItemId = Number(work_item_id ?? task_id);

    if (!Number.isInteger(workItemId) || workItemId <= 0 || !date) {
      return NextResponse.json(
        { error: 'Work item ID and date are required' },
        { status: 400 }
      );
    }

    const hoursValue = parseFloat(hours) || 0;

    if (hoursValue < 0) {
      return NextResponse.json(
        { error: 'Hours cannot be negative' },
        { status: 400 }
      );
    }

    if (hoursValue === 0) {
      db.prepare(
        `DELETE FROM time_entries 
         WHERE work_item_id = ? AND user_id = ? AND date = ?
           AND work_item_id IN (
             SELECT id
             FROM work_items
             WHERE id = ?
               AND assigned_user_id = ?
               AND project_id = ?
               AND type IN ('task', 'bug')
           )`
      ).run(workItemId, userId, date, workItemId, userId, projectId);
    } else {
      const item = getWorkItemForUser(workItemId, projectId, userId, {
        requireAssigned: true,
        requireTrackable: true,
      });
      if (!item) {
        return NextResponse.json({ error: 'Work item not found' }, { status: 404 });
      }

      db.prepare(
        `INSERT INTO time_entries (work_item_id, user_id, date, hours, updated_at) 
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) 
         ON CONFLICT(work_item_id, user_id, date) DO UPDATE SET
           hours = excluded.hours,
           updated_at = CURRENT_TIMESTAMP`
      ).run(workItemId, userId, date, hoursValue);
    }

    return NextResponse.json(
      { message: 'Time entry saved successfully' },
      { status: 200 }
    );
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to save time entry' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const taskId = searchParams.get('taskId');
    const workItemId = Number(searchParams.get('workItemId') ?? taskId);

    if (!Number.isInteger(workItemId) || workItemId <= 0) {
      return NextResponse.json(
        { error: 'workItemId is required' },
        { status: 400 }
      );
    }

    const entries = db.prepare(
      `SELECT te.date, te.hours
       FROM time_entries te
       INNER JOIN work_items wi ON wi.id = te.work_item_id
       WHERE te.work_item_id = ?
         AND te.user_id = ?
         AND wi.assigned_user_id = ?
         AND wi.project_id = ?
         AND wi.type IN ('task', 'bug')
       ORDER BY te.date DESC`
    ).all(workItemId, userId, userId, projectId);

    return NextResponse.json(entries);
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch time entries' },
      { status: 500 }
    );
  }
}
