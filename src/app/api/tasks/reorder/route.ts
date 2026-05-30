export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from '@/lib/user-context';

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { taskOrders } = body;

    if (!taskOrders || !Array.isArray(taskOrders)) {
      return NextResponse.json(
        { error: 'taskOrders array is required' },
        { status: 400 }
      );
    }

    // Update display_order for each task in a transaction
    const updateStmt = db.prepare(`
      UPDATE work_items
      SET display_order = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND assigned_user_id = ?
        AND project_id = ?
        AND type IN ('task', 'bug')
    `);
    
    const transaction = db.transaction((orders: Array<{ id: number; order: number }>) => {
      for (const { id, order } of orders) {
        updateStmt.run(order, userId, id, userId, projectId);
      }
    });

    transaction(taskOrders);

    return NextResponse.json(
      { message: 'Task order updated successfully' },
      { status: 200 }
    );
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to reorder tasks' },
      { status: 500 }
    );
  }
}
