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
    const { workItemOrders } = body;

    if (!workItemOrders || !Array.isArray(workItemOrders)) {
      return NextResponse.json(
        { error: 'workItemOrders array is required' },
        { status: 400 }
      );
    }

    const updateStmt = db.prepare(`
      UPDATE release_items
      SET display_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)
    `);
    
    const transaction = db.transaction((orders: Array<{ id: number; order: number }>) => {
      for (const { id, order } of orders) {
        updateStmt.run(order, id, projectId);
      }
    });

    transaction(workItemOrders);

    return NextResponse.json(
      { message: 'Work item order updated successfully' },
      { status: 200 }
    );
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to reorder work items' },
      { status: 500 }
    );
  }
}
