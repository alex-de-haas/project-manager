export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import * as azdev from 'azure-devops-node-api';
import type { AzureDevOpsSettings } from '@/types';
import { getAzureDevOpsProjectSettings, getAzureDevOpsUserPat } from '@/lib/azure-devops/settings';
import { parseAzureDevOpsProjectUrl } from '@/lib/azure-devops/project-url';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { organization, project, projectUrl, pat } = body as Partial<AzureDevOpsSettings>;
    const parsedProjectUrl = parseAzureDevOpsProjectUrl(projectUrl ?? "");
    const savedProjectSettings = getAzureDevOpsProjectSettings(projectId);
    const effectiveOrganization =
      parsedProjectUrl?.organization || organization?.trim() || savedProjectSettings?.organization || "";
    const effectiveProject =
      parsedProjectUrl?.project || project?.trim() || savedProjectSettings?.project || "";
    const effectivePat = pat?.trim() || getAzureDevOpsUserPat(userId) || "";

    if (!effectiveOrganization || !effectiveProject || !effectivePat) {
      return NextResponse.json(
        { error: 'Azure DevOps project URL and PAT are required' },
        { status: 400 }
      );
    }

    // Test connection
    const orgUrl = `https://dev.azure.com/${effectiveOrganization}`;
    const authHandler = azdev.getPersonalAccessTokenHandler(effectivePat);
    const connection = new azdev.WebApi(orgUrl, authHandler);

    // Try to get project info to validate connection
    const coreApi = await connection.getCoreApi();
    const projectInfo = await coreApi.getProject(effectiveProject);

    if (!projectInfo) {
      return NextResponse.json(
        { error: 'Project not found or access denied' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Connection successful',
      project: {
        name: projectInfo.name,
        id: projectInfo.id,
        description: projectInfo.description
      }
    });

  } catch (error) {
    console.error('Azure DevOps connection test error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Connection failed', details: errorMessage },
      { status: 500 }
    );
  }
}
