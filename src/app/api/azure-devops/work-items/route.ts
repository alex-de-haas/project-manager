export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { AzureDevOpsWorkItem } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';
import {
  createAzureDevOpsConnectionContext,
  getAzureDevOpsSettingsForUser,
  isAzureDevOpsConfigProblem,
} from '@/lib/azure-devops/settings';

const getUserEmail = (userId: number): string | null => {
  const user = db
    .prepare('SELECT email FROM users WHERE id = ?')
    .get(userId) as { email?: string | null } | undefined;
  return user?.email?.trim() || null;
};

const escapeWiqlString = (value: string): string => value.replace(/'/g, "''");

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const userEmail = getUserEmail(userId);

    if (!userEmail) {
      return NextResponse.json(
        { error: 'Current user email is required to load assigned work items.' },
        { status: 400 }
      );
    }
    const settingsResult = getAzureDevOpsSettingsForUser(userId, projectId);
    if (isAzureDevOpsConfigProblem(settingsResult)) {
      return NextResponse.json(
        { error: settingsResult.message },
        { status: 400 }
      );
    }

    const { settings, witApi } = await createAzureDevOpsConnectionContext(settingsResult);

    // Query for work items assigned to the authenticated app user
    const escapedUserEmail = escapeWiqlString(userEmail);
    const wiql = {
      query: `
        SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State]
        FROM WorkItems
        WHERE [System.AssignedTo] = '${escapedUserEmail}'
          AND [System.TeamProject] = @project
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
      SELECT external_id
      FROM tasks
      WHERE external_source = 'azure_devops'
        AND user_id = ?
        AND project_id = ?
        AND external_id IS NOT NULL
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
      .map(wi => ({
        id: wi.id!,
        title: wi.fields?.['System.Title'] || 'Untitled',
        type: wi.fields?.['System.WorkItemType'] || 'Unknown',
        state: wi.fields?.['System.State'] || 'Unknown',
      }))
      .filter((item) => !importedIds.has(item.id));

    return NextResponse.json({ workItems: result });
  } catch (error) {
    console.error('Error fetching Azure DevOps work items:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch work items' },
      { status: 500 }
    );
  }
}
