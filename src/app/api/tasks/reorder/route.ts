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

    // Update the current user's Time Management order.
    const updateStmt = db.prepare(`
      UPDATE time_tracking_items
      SET display_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE work_item_id = ?
        AND user_id = ?
        AND project_id = ?
        AND EXISTS (
          SELECT 1
          FROM work_items wi
          WHERE wi.id = time_tracking_items.work_item_id
            AND wi.project_id = time_tracking_items.project_id
            AND wi.type IN ('task', 'bug')
        )
    `);
    
    const transaction = db.transaction((orders: Array<{ id: number; order: number }>) => {
      for (const { id, order } of orders) {
        updateStmt.run(order, id, userId, projectId);
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
