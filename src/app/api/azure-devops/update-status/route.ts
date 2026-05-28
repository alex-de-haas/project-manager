export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { JsonPatchDocument, JsonPatchOperation, Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import db from '@/lib/db';
import type { Task } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';
import {
  createAzureDevOpsConnectionContext,
  getAzureDevOpsAuthenticatedUser,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from '@/lib/azure-devops/settings';
import {
  isAzureDevOpsIdentityAssignedToUser,
  normalizeAzureDevOpsWorkItemIdentity,
} from '@/lib/azure-devops/identity';

const completedStatuses = ['closed', 'resolved', 'done', 'completed'];

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { taskId, status } = body;

    if (!taskId || !status) {
      return NextResponse.json(
        { error: 'Task ID and status are required' },
        { status: 400 }
      );
    }

    // Get the task from database
    const task = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
      .get(taskId, userId, projectId) as Task | undefined;

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Determine if status is a "completed" state
    const isCompleted = completedStatuses.includes(status.toLowerCase());

    if (isCompleted) {
      const checklistSummary = db.prepare(
        `SELECT 
          COUNT(*) as total,
         SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed
         FROM checklist_items
         WHERE task_id = ? AND user_id = ? AND project_id = ?`
      ).get(taskId, userId, projectId) as { total: number; completed: number | null } | undefined;

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
    
    const wasCompleted = task.status ? completedStatuses.includes(task.status.toLowerCase()) : false;

    // Update local status and completed_at
    if (isCompleted && !wasCompleted) {
      // Task is being completed - set completed_at to now
      db.prepare('UPDATE tasks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND project_id = ?').run(status, taskId, userId, projectId);
    } else if (!isCompleted && wasCompleted) {
      // Task is being reopened - clear completed_at
      db.prepare('UPDATE tasks SET status = ?, completed_at = NULL WHERE id = ? AND user_id = ? AND project_id = ?').run(status, taskId, userId, projectId);
    } else {
      // Status change doesn't affect completion - just update status
      db.prepare('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ? AND project_id = ?').run(status, taskId, userId, projectId);
    }

    // If task is linked to Azure DevOps, update it there too
    if (task.external_source === 'azure_devops' && task.external_id) {
      try {
        const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
        if (isAzureDevOpsConfigProblem(settingsResult)) {
          return NextResponse.json({
            success: true,
            message: `Status updated locally. ${settingsResult.message}`,
            localOnly: true
          });
        }

        const { settings, connection, witApi } =
          await createAzureDevOpsConnectionContext(settingsResult);
        const authenticatedUser = await getAzureDevOpsAuthenticatedUser(connection);

        const workItemId = parseInt(task.external_id);
        if (isNaN(workItemId)) {
          return NextResponse.json({
            success: true,
            message: 'Status updated locally. Invalid work item ID.',
            localOnly: true
          });
        }

        // Create patch document to update the status
        const patchOperations: JsonPatchOperation[] = [
          {
            op: Operation.Add,
            path: '/fields/System.State',
            value: status
          } as JsonPatchOperation
        ];

        // If closing a task or resolving a bug, set completed work hours
        const shouldUpdateCompletedWork = 
          (task.type === 'task' && status === 'Closed') ||
          (task.type === 'bug' && status === 'Resolved');

        if (shouldUpdateCompletedWork) {
          // Calculate total hours from time entries
          const timeEntries = db.prepare(
            `SELECT SUM(te.hours) as total
             FROM time_entries te
             INNER JOIN tasks t ON t.id = te.task_id
             WHERE te.task_id = ? AND t.user_id = ? AND t.project_id = ?`
          ).get(taskId, userId, projectId) as { total: number | null } | undefined;

          const totalHours = timeEntries?.total || 0;

          if (totalHours > 0) {
            // Add completed work field to patch document
            patchOperations.push({
              op: Operation.Add,
              path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork',
              value: totalHours
            } as JsonPatchOperation);
          }
        }

        const patchDocument: JsonPatchDocument = patchOperations;

        // Update the work item in Azure DevOps
        await witApi.updateWorkItem(
          undefined,
          patchDocument,
          workItemId,
          settings.project
        );

        const refreshedWorkItems = await witApi.getWorkItems(
          [workItemId],
          undefined,
          undefined,
          undefined,
          undefined
        );
        const refreshedWorkItem = refreshedWorkItems?.[0];

        if (refreshedWorkItem?.fields) {
          const title =
            (refreshedWorkItem.fields['System.Title'] as string) ||
            task.title;
          const workItemType = (
            (refreshedWorkItem.fields['System.WorkItemType'] as string) ||
            task.type ||
            'Task'
          ).toLowerCase();
          const refreshedStatus =
            (refreshedWorkItem.fields['System.State'] as string) || status;
          const tags =
            (refreshedWorkItem.fields['System.Tags'] as string) || null;
          const assignedTo = normalizeAzureDevOpsWorkItemIdentity(
            refreshedWorkItem.fields['System.AssignedTo']
          );
          const isAssignedToCurrentUser = isAzureDevOpsIdentityAssignedToUser(
            assignedTo,
            authenticatedUser
          );
          const closedDate =
            (refreshedWorkItem.fields['Microsoft.VSTS.Common.ClosedDate'] as string) ||
            (refreshedWorkItem.fields['Microsoft.VSTS.Common.ResolvedDate'] as string) ||
            (refreshedWorkItem.fields['System.ClosedDate'] as string) ||
            null;
          const refreshedIsCompleted = completedStatuses.includes(
            refreshedStatus.toLowerCase()
          );
          const completedAt = refreshedIsCompleted
            ? closedDate || task.completed_at || new Date().toISOString()
            : null;
          const taskType = workItemType === 'bug' ? 'bug' : 'task';
          const isAssignedToCurrentUserValue =
            isAssignedToCurrentUser === null
              ? null
              : isAssignedToCurrentUser
                ? 1
                : 0;

          db.prepare(
            `UPDATE tasks
             SET
               title = ?,
               type = ?,
               status = ?,
               tags = ?,
               completed_at = ?,
               azure_assigned_to_id = ?,
               azure_assigned_to_name = ?,
               azure_assigned_to_unique_name = ?,
               azure_assignee_is_current_user = ?
             WHERE id = ? AND user_id = ? AND project_id = ?`
          ).run(
            title,
            taskType,
            refreshedStatus,
            tags,
            completedAt,
            assignedTo?.id ?? null,
            assignedTo?.displayName ?? null,
            assignedTo?.uniqueName ?? null,
            isAssignedToCurrentUserValue,
            taskId,
            userId,
            projectId
          );
        }

        return NextResponse.json({
          success: true,
          message: 'Status updated locally and synced with Azure DevOps',
          synced: true
        });

      } catch (azureError) {
        console.error('Azure DevOps update error:', azureError);
        const errorMessage = azureError instanceof Error ? azureError.message : 'Unknown error';
        
        return NextResponse.json({
          success: true,
          message: `Status updated locally. Failed to sync with Azure DevOps: ${errorMessage}`,
          localOnly: true,
          azureError: errorMessage
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Status updated successfully',
      localOnly: !task.external_source
    });

  } catch (error) {
    console.error('Status update error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to update status', details: errorMessage },
      { status: 500 }
    );
  }
}
