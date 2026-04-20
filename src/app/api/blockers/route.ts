export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Blocker } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const taskId = searchParams.get('taskId');

    if (taskId) {
      // Get blockers for a specific task
      const blockers = db.prepare(
        'SELECT * FROM blockers WHERE task_id = ? AND user_id = ? AND project_id = ? ORDER BY created_at DESC'
      ).all(taskId, userId, projectId) as Blocker[];

      return NextResponse.json(blockers);
    } else {
      // Get all blockers
      const blockers = db.prepare(
        'SELECT * FROM blockers WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC'
      ).all(userId, projectId) as Blocker[];

      return NextResponse.json(blockers);
    }
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blockers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { task_id, comment, severity = 'medium' } = body;

    if (!task_id || !comment) {
      return NextResponse.json(
        { error: 'Task ID and comment are required' },
        { status: 400 }
      );
    }

    if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
      return NextResponse.json(
        { error: 'Invalid severity level' },
        { status: 400 }
      );
    }

    const task = db
      .prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
      .get(task_id, userId, projectId) as { id: number } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const result = db.prepare(
      'INSERT INTO blockers (user_id, project_id, task_id, comment, severity) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, projectId, task_id, comment, severity);

    return NextResponse.json(
      { message: 'Blocker created successfully', id: result.lastInsertRowid },
      { status: 201 }
    );
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to create blocker' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { id, comment, severity, is_resolved, resolution_comment } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Blocker ID is required' },
        { status: 400 }
      );
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (comment !== undefined) {
      if (typeof comment !== 'string' || !comment.trim()) {
        return NextResponse.json(
          { error: 'Comment is required' },
          { status: 400 }
        );
      }

      updates.push('comment = ?');
      values.push(comment.trim());
    }

    if (severity !== undefined) {
      if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
        return NextResponse.json(
          { error: 'Invalid severity level' },
          { status: 400 }
        );
      }
      updates.push('severity = ?');
      values.push(severity);
    }

    if (resolution_comment !== undefined && resolution_comment !== null && typeof resolution_comment !== 'string') {
      return NextResponse.json(
        { error: 'Resolution comment must be a string or null' },
        { status: 400 }
      );
    }

    if (is_resolved !== undefined) {
      updates.push('is_resolved = ?');
      values.push(is_resolved ? 1 : 0);
      
      if (is_resolved) {
        updates.push('resolved_at = CURRENT_TIMESTAMP');
        updates.push('resolution_comment = ?');
        values.push(typeof resolution_comment === 'string' && resolution_comment.trim() ? resolution_comment.trim() : null);
      } else {
        updates.push('resolved_at = NULL');
        updates.push('resolution_comment = NULL');
      }
    } else if (resolution_comment !== undefined) {
      updates.push('resolution_comment = ?');
      values.push(typeof resolution_comment === 'string' && resolution_comment.trim() ? resolution_comment.trim() : null);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(id);
    values.push(userId);
    values.push(projectId);
    const sql = `UPDATE blockers SET ${updates.join(', ')} WHERE id = ? AND user_id = ? AND project_id = ?`;
    const result = db.prepare(sql).run(...values);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Blocker not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Blocker updated successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to update blocker' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const blockerId = searchParams.get('id');

    if (!blockerId) {
      return NextResponse.json(
        { error: 'Blocker ID is required' },
        { status: 400 }
      );
    }

    const result = db.prepare('DELETE FROM blockers WHERE id = ? AND user_id = ? AND project_id = ?').run(blockerId, userId, projectId);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Blocker not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Blocker deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to delete blocker' },
      { status: 500 }
    );
  }
}
