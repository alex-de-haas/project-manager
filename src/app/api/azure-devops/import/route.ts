export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { Task } from "@/types";
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from "@/lib/user-context";
import {
  createAzureDevOpsConnectionContext,
  getOrResolveAzureDevOpsUserIdentity,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from "@/lib/azure-devops/settings";
import {
  createAzureDevOpsUserMapper,
  isAzureDevOpsIdentityAssignedToUser,
  normalizeAzureDevOpsWorkItemIdentity,
} from "@/lib/azure-devops/identity";
import {
  ensureTimeTrackingItem,
  mapAzureDevOpsStatusToWorkItemStatus,
  mapAzureDevOpsTypeToTrackableWorkItemType,
  upsertExternalLink,
} from "@/lib/work-items";

interface ImportRequest {
  workItemIds?: number[];
  query?: string;
  assignedToMe?: boolean;
}

const escapeWiqlString = (value: string): string => value.replace(/'/g, "''");

const readImportedTask = (workItemId: number): Task =>
  db
    .prepare(
      `
        SELECT
          wi.*,
          wi.assigned_user_id AS user_id,
          link.external_id,
          link.provider AS external_source
        FROM work_items wi
        LEFT JOIN work_item_external_links link
          ON link.work_item_id = wi.id
          AND link.provider = 'azure_devops'
        WHERE wi.id = ?
      `
    )
    .get(workItemId) as Task;

const hasCurrentProjectScope = (query: string, project: string): boolean => {
  const normalizedQuery = query.replace(/\s+/g, " ").toLowerCase();
  const normalizedProject = escapeWiqlString(project).toLowerCase();
  return (
    normalizedQuery.includes("system.teamproject") &&
    (normalizedQuery.includes("@project") ||
      normalizedQuery.includes(`'${normalizedProject}'`))
  );
};

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body: ImportRequest = await request.json();

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json({ error: settingsResult.message }, { status: 400 });
    }

    const { settings, connection, witApi } =
      await createAzureDevOpsConnectionContext(settingsResult);
    const authenticatedUser = await getOrResolveAzureDevOpsUserIdentity(
      userId,
      projectId,
      connection
    );

    let workItemIds: number[] = [];
    let assignedToCurrentUserIds = new Set<number>();

    if (body.workItemIds && body.workItemIds.length > 0) {
      workItemIds = body.workItemIds;
    } else if (body.assignedToMe) {
      const wiql = {
        query: `
          SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State]
          FROM WorkItems
          WHERE [System.AssignedTo] = @Me
            AND [System.TeamProject] = @project
            AND [System.WorkItemType] IN ('Task', 'Bug')
            AND [System.State] <> 'Closed'
            AND [System.State] <> 'Removed'
          ORDER BY [System.ChangedDate] DESC
        `,
      };

      const queryResult = await witApi.queryByWiql(wiql, { project: settings.project });
      workItemIds = queryResult?.workItems?.map((wi) => wi.id!).filter(Boolean) || [];
      assignedToCurrentUserIds = new Set(workItemIds);
    } else if (body.query) {
      if (!hasCurrentProjectScope(body.query, settings.project)) {
        return NextResponse.json(
          {
            error:
              "Custom WIQL queries must include a System.TeamProject filter for the configured project.",
          },
          { status: 400 }
        );
      }
      const queryResult = await witApi.queryByWiql(
        { query: body.query },
        { project: settings.project }
      );
      workItemIds = queryResult?.workItems?.map((wi) => wi.id!).filter(Boolean) || [];
    } else {
      return NextResponse.json(
        {
          error:
            "No work items specified. Provide workItemIds, set assignedToMe=true, or provide a WIQL query.",
        },
        { status: 400 }
      );
    }

    if (workItemIds.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        message: "No work items found to import",
      });
    }

    const workItems = await witApi.getWorkItems(
      workItemIds,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const imported: Task[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];
    const findMappedAssignedUserId = createAzureDevOpsUserMapper(projectId);

    for (const workItem of workItems || []) {
      if (!workItem.id || !workItem.fields) continue;

      const title = (workItem.fields["System.Title"] as string) || `Work Item ${workItem.id}`;
      const nativeType = (workItem.fields["System.WorkItemType"] as string) || "Task";
      const type = mapAzureDevOpsTypeToTrackableWorkItemType(nativeType);
      if (!type) {
        skipped.push({
          id: workItem.id,
          reason: "Only Azure DevOps Tasks and Bugs can be imported into Time Management",
        });
        continue;
      }

      const nativeStatus = (workItem.fields["System.State"] as string) || null;
      const status = mapAzureDevOpsStatusToWorkItemStatus(nativeStatus);
      const tags = (workItem.fields["System.Tags"] as string) || null;
      const assignedTo = normalizeAzureDevOpsWorkItemIdentity(
        workItem.fields["System.AssignedTo"]
      );
      const isAssignedToCurrentUser = isAzureDevOpsIdentityAssignedToUser(
        assignedTo,
        authenticatedUser
      );
      const isKnownAssignedToCurrentUser =
        assignedToCurrentUserIds.has(workItem.id) || isAssignedToCurrentUser;
      const mappedAssignedUserId = findMappedAssignedUserId(assignedTo);
      const assignedUserId =
        mappedAssignedUserId ?? (isKnownAssignedToCurrentUser === true ? userId : null);
      const closedDate =
        (workItem.fields["Microsoft.VSTS.Common.ClosedDate"] as string) ||
        (workItem.fields["Microsoft.VSTS.Common.ResolvedDate"] as string) ||
        (workItem.fields["System.ClosedDate"] as string) ||
        null;

      const existing = db
        .prepare(
          `
            SELECT wi.id, wi.assigned_user_id
            FROM work_item_external_links link
            INNER JOIN work_items wi ON wi.id = link.work_item_id
            WHERE link.project_id = ?
              AND link.provider = 'azure_devops'
              AND link.external_id = ?
              AND wi.type IN ('task', 'bug')
            LIMIT 1
          `
        )
        .get(projectId, String(workItem.id)) as
        | { id: number; assigned_user_id: number | null }
        | undefined;

      if (existing) {
        db.prepare(
          `
            UPDATE work_items
            SET title = ?,
                type = ?,
                status = ?,
                tags = ?,
                assigned_user_id = ?,
                completed_at = ?,
                sync_state = 'synced',
                updated_by_user_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND project_id = ?
          `
        ).run(
          title,
          type,
          status,
          tags,
          assignedUserId,
          status === "completed" ? closedDate ?? new Date().toISOString() : null,
          userId,
          existing.id,
          projectId
        );

        upsertExternalLink({
          workItemId: existing.id,
          projectId,
          provider: "azure_devops",
          externalId: workItem.id,
          nativeType,
          nativeStatus,
          nativeAssigneeId: assignedTo?.id ?? null,
          nativeAssigneeName: assignedTo?.displayName ?? null,
          nativeAssigneeUniqueName: assignedTo?.uniqueName ?? null,
          nativeAssigneeIsCurrentUser: isKnownAssignedToCurrentUser,
          sanitizedSnapshot: {
            id: workItem.id,
            title,
            type: nativeType,
            state: nativeStatus,
            tags,
          },
        });

        const trackingResult = assignedUserId
          ? ensureTimeTrackingItem({
              projectId,
              userId: assignedUserId,
              workItemId: existing.id,
              addedByUserId: userId,
            })
          : null;

        if (trackingResult?.created) {
          imported.push(readImportedTask(existing.id));
        } else {
          skipped.push({
            id: workItem.id,
            reason: assignedUserId
              ? "Already added to Time Management; assignment refreshed"
              : "Already imported; no matching Project Manager assignee",
          });
        }
        continue;
      }

      const result = db
        .prepare(
          `
            INSERT INTO work_items (
              project_id,
              title,
              type,
              status,
              tags,
              assigned_user_id,
              completed_at,
              sync_state,
              created_by_user_id,
              updated_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
          `
        )
        .run(
          projectId,
          title,
          type,
          status,
          tags,
          assignedUserId,
          status === "completed" ? closedDate ?? new Date().toISOString() : null,
          userId,
          userId
        );

      const workItemId = Number(result.lastInsertRowid);
      upsertExternalLink({
        workItemId,
        projectId,
        provider: "azure_devops",
        externalId: workItem.id,
        nativeType,
        nativeStatus,
        nativeAssigneeId: assignedTo?.id ?? null,
        nativeAssigneeName: assignedTo?.displayName ?? null,
        nativeAssigneeUniqueName: assignedTo?.uniqueName ?? null,
        nativeAssigneeIsCurrentUser: isKnownAssignedToCurrentUser,
        sanitizedSnapshot: {
          id: workItem.id,
          title,
          type: nativeType,
          state: nativeStatus,
          tags,
        },
      });

      if (assignedUserId) {
        ensureTimeTrackingItem({
          projectId,
          userId: assignedUserId,
          workItemId,
          addedByUserId: userId,
        });
        imported.push(readImportedTask(workItemId));
      } else {
        skipped.push({
          id: workItem.id,
          reason: "Imported as a stored work item, but no matching Project Manager assignee was found",
        });
      }
    }

    return NextResponse.json({
      imported: imported.length,
      skipped: skipped.length,
      tasks: imported,
      skippedDetails: skipped,
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error("Azure DevOps import error:", error);
    return NextResponse.json(
      {
        error: "Failed to import from Azure DevOps",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
