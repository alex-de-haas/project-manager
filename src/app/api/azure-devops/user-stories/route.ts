export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import * as azdev from "azure-devops-node-api";
import { WorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi";
import db from "@/lib/db";
import type {
  Settings,
  AzureDevOpsSettings,
  AzureDevOpsWorkItem,
} from "@/types";
import { getRequestProjectId, getRequestUserId } from "@/lib/user-context";

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const releaseIdParam = searchParams.get("releaseId");
    const releaseId = releaseIdParam ? Number(releaseIdParam) : null;
    const searchParam = (searchParams.get("search") || "").trim();
    const searchText = searchParam.length > 0 ? searchParam : null;
    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam ? Number(limitParam) : 20;
    const allowedLimits = new Set([10, 20, 50]);
    const resultLimit = allowedLimits.has(parsedLimit) ? parsedLimit : 20;

    if (releaseIdParam && Number.isNaN(releaseId)) {
      return NextResponse.json(
        { error: "Release id must be a number" },
        { status: 400 }
      );
    }

    const settingRow = db
      .prepare("SELECT id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?")
      .get("azure_devops", projectId) as Settings | undefined;

    if (!settingRow) {
      return NextResponse.json(
        {
          error:
            "Azure DevOps settings not configured. Please configure in Settings.",
        },
        { status: 400 }
      );
    }

    let settings: AzureDevOpsSettings;
    try {
      settings = JSON.parse(settingRow.value) as AzureDevOpsSettings;
    } catch {
      return NextResponse.json(
        { error: "Invalid Azure DevOps settings format" },
        { status: 400 }
      );
    }

    if (!settings.organization || !settings.project || !settings.pat) {
      return NextResponse.json(
        {
          error:
            "Azure DevOps settings incomplete. Please check organization, project, and PAT.",
        },
        { status: 400 }
      );
    }

    const orgUrl = `https://dev.azure.com/${settings.organization}`;
    const authHandler = azdev.getPersonalAccessTokenHandler(settings.pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);

    const witApi: WorkItemTrackingApi =
      await connection.getWorkItemTrackingApi();

    const escapedSearchText = searchText
      ? searchText.replace(/'/g, "''")
      : null;
    const isNumericSearch = searchText ? /^\d+$/.test(searchText) : false;
    const searchClause = searchText
      ? isNumericSearch
        ? `AND ([System.Title] CONTAINS '${escapedSearchText}' OR [System.Id] = ${Number(
            searchText
          )})`
        : `AND [System.Title] CONTAINS '${escapedSearchText}'`
      : "";
    const wiqlQuery = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.WorkItemType] = 'User Story'
        AND [System.TeamProject] = @project
        AND [System.State] <> 'Closed'
        AND [System.State] <> 'Removed'
        AND [System.State] <> 'Released'
        AND [System.State] <> 'Resolved'
        ${searchClause}
      ORDER BY [System.ChangedDate] DESC
    `;

    const wiql = { query: wiqlQuery };

    const queryResult = await witApi.queryByWiql(
      wiql,
      { project: settings.project },
      undefined,
      resultLimit
    );
    const workItemIds =
      queryResult?.workItems?.map((wi) => wi.id!).filter(Boolean) || [];

    if (workItemIds.length === 0) {
      return NextResponse.json({ workItems: [] });
    }

    // Fetch work items in batches to avoid request header size limits
    const batchSize = 200;
    const allWorkItems = [];
    
    for (let i = 0; i < workItemIds.length; i += batchSize) {
      const batch = workItemIds.slice(i, i + batchSize);
      const batchItems = await witApi.getWorkItems(
        batch,
        undefined,
        undefined,
        undefined,
        undefined
      );
      if (batchItems) {
        allWorkItems.push(...batchItems);
      }
    }

    const workItems = allWorkItems;

    const importedIds = new Set<number>();

    if (releaseId) {
      const importedRows = db
        .prepare(
          `
          SELECT external_id
          FROM release_work_items
          WHERE release_id = ?
            AND project_id = ?
            AND external_source = 'azure_devops'
            AND external_id IS NOT NULL
        `
        )
        .all(releaseId, projectId) as Array<{ external_id: string | number | null }>;

      importedRows.forEach((row) => {
        const numericId = Number(row.external_id);
        if (!Number.isNaN(numericId)) {
          importedIds.add(numericId);
        }
      });
    }

    const rankedWorkItems: Array<AzureDevOpsWorkItem & { changedAtTs: number }> = (
      workItems || []
    )
      .filter((wi) => wi.id && wi.fields)
      .map((wi) => {
        const id = wi.id!;
        const tagsString = wi.fields?.["System.Tags"] as string | undefined;
        const tags = tagsString
          ? tagsString
              .split(";")
              .map((t) => t.trim())
              .filter(Boolean)
          : [];
        const changedDateValue = wi.fields?.["System.ChangedDate"];
        const changedAtTs =
          typeof changedDateValue === "string" ||
          changedDateValue instanceof Date
            ? new Date(changedDateValue).getTime()
            : 0;
        return {
          id,
          title: wi.fields?.["System.Title"] || "Untitled",
          type: wi.fields?.["System.WorkItemType"] || "Unknown",
          state: wi.fields?.["System.State"] || "Unknown",
          tags: tags.length > 0 ? tags : undefined,
          isImported: importedIds.has(id),
          changedAtTs,
        };
      })
      .sort((a, b) => {
        if (a.isImported !== b.isImported) {
          return a.isImported ? 1 : -1;
        }
        return b.changedAtTs - a.changedAtTs;
      });

    const result: AzureDevOpsWorkItem[] = rankedWorkItems
      .slice(0, resultLimit)
      .map(({ changedAtTs, ...item }) => item);

    return NextResponse.json({ workItems: result });
  } catch (error) {
    console.error("Error fetching Azure DevOps user stories:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch user stories",
      },
      { status: 500 }
    );
  }
}
