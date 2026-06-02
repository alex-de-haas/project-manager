export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { AzureDevOpsWorkItem } from '@/types';
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from '@/lib/user-context';
import {
  createAzureDevOpsConnectionContext,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from '@/lib/azure-devops/settings';
import { mapAzureDevOpsTypeToTrackableWorkItemType } from '@/lib/work-items';

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);

    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json(
        { error: settingsResult.message },
        { status: 400 }
      );
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);

    // @Me is resolved by Azure DevOps from the PAT-authenticated request identity.
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
      `
    };

    const queryResult = await witApi.queryByWiql(wiql, { project: settings.project });
    const workItemIds = queryResult?.workItems?.map(wi => wi.id!).filter(Boolean) || [];

    if (workItemIds.length === 0) {
      return NextResponse.json({ workItems: [] });
    }

    // Fetch work item details
    const workItems = await witApi.getWorkItems(
      workItemIds,
      undefined,
      undefined,
      undefined,
      undefined
    );

    const importedRows = db.prepare(`
      SELECT link.external_id
      FROM work_item_external_links link
      INNER JOIN work_items wi ON wi.id = link.work_item_id
      WHERE link.provider = 'azure_devops'
        AND wi.assigned_user_id = ?
        AND wi.project_id = ?
        AND link.external_id IS NOT NULL
    `).all(userId, projectId) as Array<{ external_id: string | number | null }>;

    const importedIds = new Set<number>();
    importedRows.forEach((row) => {
      const numericId = Number(row.external_id);
      if (!Number.isNaN(numericId)) {
        importedIds.add(numericId);
      }
    });

    const result: AzureDevOpsWorkItem[] = (workItems || [])
      .filter(wi => wi.id && wi.fields)
      .map((wi) => {
        const nativeType = wi.fields?.['System.WorkItemType'] || 'Unknown';
        const type = mapAzureDevOpsTypeToTrackableWorkItemType(nativeType);
        if (!type) return null;

        return {
          id: wi.id!,
          title: wi.fields?.['System.Title'] || 'Untitled',
          type: nativeType,
          state: wi.fields?.['System.State'] || 'Unknown',
        };
      })
      .filter((item): item is AzureDevOpsWorkItem => item !== null)
      .filter((item) => !importedIds.has(item.id));

    return NextResponse.json({ workItems: result });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error('Error fetching Azure DevOps work items:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch work items' },
      { status: 500 }
    );
  }
}
