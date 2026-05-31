export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";

export async function PATCH(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { releaseOrders } = body as {
      releaseOrders?: Array<{ id: number; order: number }>;
    };

    if (!releaseOrders || !Array.isArray(releaseOrders)) {
      return NextResponse.json(
        { error: "releaseOrders array is required" },
        { status: 400 }
      );
    }

    const updateStmt = db.prepare(
      "UPDATE releases SET display_order = ? WHERE id = ? AND project_id = ?"
    );

    const transaction = db.transaction(
      (orders: Array<{ id: number; order: number }>) => {
        for (const { id, order } of orders) {
          updateStmt.run(order, id, projectId);
        }
      }
    );

    transaction(releaseOrders);

    return NextResponse.json(
      { message: "Release order updated successfully" },
      { status: 200 }
    );
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to reorder releases" },
      { status: 500 }
    );
  }
}
