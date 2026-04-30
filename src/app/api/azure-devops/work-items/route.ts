export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import * as azdev from 'azure-devops-node-api';
import { WorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import db from '@/lib/db';
import type { Settings, AzureDevOpsSettings, AzureDevOpsWorkItem } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';

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
    // Get Azure DevOps settings
    const settingRow = db
      .prepare('SELECT id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?')
      .get('azure_devops', projectId) as Settings | undefined;
    
    if (!settingRow) {
      return NextResponse.json(
        { error: 'Azure DevOps settings not configured. Please configure in Settings.' },
        { status: 400 }
      );
    }

    let settings: AzureDevOpsSettings;
    try {
      settings = JSON.parse(settingRow.value) as AzureDevOpsSettings;
    } catch {
      return NextResponse.json(
        { error: 'Invalid Azure DevOps settings format' },
        { status: 400 }
      );
    }

    if (!settings.organization || !settings.project || !settings.pat) {
      return NextResponse.json(
        { error: 'Azure DevOps settings incomplete. Please check organization, project, and PAT.' },
        { status: 400 }
      );
    }

    // Create Azure DevOps connection
    const orgUrl = `https://dev.azure.com/${settings.organization}`;
    const authHandler = azdev.getPersonalAccessTokenHandler(settings.pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);

    const witApi: WorkItemTrackingApi = await connection.getWorkItemTrackingApi();

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
