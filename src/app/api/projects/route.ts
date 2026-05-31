export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import type { Project } from "@/types";
import { getRequestUserId } from "@/lib/user-context";
import { getProjectsForUser } from "@/lib/projects";
import { requireAdminUser } from "@/lib/authorization";
import {
  clearDefaultProjectReferences,
  getDefaultProjectIdForUser,
} from "@/lib/default-project";
import {
  AZURE_DEVOPS_SETTINGS_KEY,
  getAzureDevOpsProjectSettings,
  normalizeAzureDevOpsProjectSettings,
  upsertAzureDevOpsProjectSettings,
} from "@/lib/azure-devops/settings";

type ParsedMemberUserIds = {
  memberUserIds: number[];
  error: string | null;
};

const parseMemberUserIds = (value: unknown): ParsedMemberUserIds => {
  if (value === undefined) {
    return { memberUserIds: [], error: null };
  }

  if (!Array.isArray(value)) {
    return { memberUserIds: [], error: "memberUserIds must be an array of user IDs" };
  }

  const memberUserIds: number[] = [];
  for (const item of value) {
    const memberId = Number(item);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return { memberUserIds: [], error: "memberUserIds must contain positive integer user IDs" };
    }
    memberUserIds.push(memberId);
  }

  return { memberUserIds: Array.from(new Set(memberUserIds)), error: null };
};

const getProjectResponse = (projectId: number) => {
  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Project | undefined;
  if (!project) return null;

  const members = db
    .prepare("SELECT user_id FROM project_members WHERE project_id = ? ORDER BY user_id ASC")
    .all(projectId) as Array<{ user_id: number }>;

  return {
    ...project,
    member_user_ids: members.map((member) => member.user_id),
    azure_devops: getAzureDevOpsProjectSettings(projectId),
  };
};

const replaceProjectMembers = (
  projectId: number,
  memberUserIds: number[],
  addedByUserId: number
) => {
  db.prepare("DELETE FROM project_members WHERE project_id = ?").run(projectId);
  const insert = db.prepare(
    "INSERT INTO project_members (project_id, user_id, added_by_user_id) VALUES (?, ?, ?)"
  );

  for (const memberId of memberUserIds) {
    insert.run(projectId, memberId, addedByUserId);
  }
};

const validateProjectMemberUserIds = (memberUserIds: number[]): string | null => {
  if (memberUserIds.length === 0) {
    return null;
  }

  const placeholders = memberUserIds.map(() => "?").join(", ");
  const users = db
    .prepare(`SELECT id, is_admin FROM users WHERE id IN (${placeholders})`)
    .all(...memberUserIds) as Array<{ id: number; is_admin: number }>;
  const foundUserIds = new Set(users.map((user) => user.id));
  const missingUserIds = memberUserIds.filter((memberId) => !foundUserIds.has(memberId));
  if (missingUserIds.length > 0) {
    return "Project member users must exist";
  }

  const adminUserIds = users
    .filter((user) => user.is_admin === 1)
    .map((user) => user.id);
  if (adminUserIds.length > 0) {
    return "Host administrators already have project access and cannot be assigned as project members";
  }

  return null;
};

const applyAzureProjectUrl = (projectId: number, value: unknown) => {
  if (value === undefined) return;

  const projectUrl = typeof value === "string" ? value.trim() : "";
  if (!projectUrl) {
    db.prepare("DELETE FROM project_settings WHERE project_id = ? AND key = ?").run(
      projectId,
      AZURE_DEVOPS_SETTINGS_KEY
    );
    db.prepare(
      `
        UPDATE projects
        SET integration_provider = 'none',
            integration_enabled = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
    ).run(projectId);
    db.prepare(
      `
        UPDATE work_item_external_links
        SET sync_enabled = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE project_id = ?
      `
    ).run(projectId);
    return;
  }

  const settings = normalizeAzureDevOpsProjectSettings({ projectUrl, pat: "" });
  if (!settings) {
    throw new Error("A valid Azure DevOps project URL is required");
  }

  upsertAzureDevOpsProjectSettings(projectId, settings);
  db.prepare(
    `
      UPDATE projects
      SET integration_provider = 'azure_devops',
          integration_enabled = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
  ).run(projectId);
  db.prepare(
    `
      UPDATE work_item_external_links
      SET sync_enabled = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ? AND provider = 'azure_devops'
    `
  ).run(projectId);
};

const assertProviderCanChange = (
  projectId: number,
  nextProvider: "none" | "azure_devops"
): string | null => {
  const project = db
    .prepare("SELECT integration_provider FROM projects WHERE id = ?")
    .get(projectId) as { integration_provider: "none" | "azure_devops" } | undefined;
  if (!project || project.integration_provider === nextProvider) return null;
  if (nextProvider === "none") return null;

  const link = db
    .prepare(
      "SELECT id FROM work_item_external_links WHERE project_id = ? AND provider != ? LIMIT 1"
    )
    .get(projectId, nextProvider) as { id: number } | undefined;
  return link
    ? "Cannot switch provider while external work item links exist"
    : null;
};

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const defaultProjectId = getDefaultProjectIdForUser(userId);
    return NextResponse.json(
      getProjectsForUser(userId).map((project) => ({
        ...project,
        azure_devops: getAzureDevOpsProjectSettings(project.id),
        is_default: project.id === defaultProjectId,
      }))
    );
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;
    const userId = admin.userId;
    const body = await request.json();
    const name = String(body?.name ?? "").trim();
    const description =
      typeof body?.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    const parsedMemberUserIds = parseMemberUserIds(body?.memberUserIds);
    if (parsedMemberUserIds.error) {
      return NextResponse.json({ error: parsedMemberUserIds.error }, { status: 400 });
    }
    const memberUserIds = parsedMemberUserIds.memberUserIds;
    const memberValidationError = validateProjectMemberUserIds(memberUserIds);
    if (memberValidationError) {
      return NextResponse.json({ error: memberValidationError }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }
    if (
      typeof body?.azureProjectUrl === "string" &&
      body.azureProjectUrl.trim() &&
      !normalizeAzureDevOpsProjectSettings({ projectUrl: body.azureProjectUrl, pat: "" })
    ) {
      return NextResponse.json(
        { error: "A valid Azure DevOps project URL is required" },
        { status: 400 }
      );
    }

    const duplicate = db
      .prepare("SELECT id FROM projects WHERE lower(name) = lower(?)")
      .get(name) as { id: number } | undefined;
    if (duplicate) {
      return NextResponse.json({ error: "A project with this name already exists" }, { status: 409 });
    }

    const inserted = db
      .prepare(
        "INSERT INTO projects (user_id, name, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)"
      )
      .run(userId, name, description);
    const projectId = Number(inserted.lastInsertRowid);
    replaceProjectMembers(projectId, memberUserIds, userId);
    applyAzureProjectUrl(projectId, body?.azureProjectUrl);

    const project = getProjectResponse(projectId);

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "A valid Azure DevOps project URL is required") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;
    const userId = admin.userId;
    const body = await request.json();
    const projectId = Number(body?.id);
    const name = body?.name !== undefined ? String(body?.name).trim() : undefined;
    const description =
      body?.description !== undefined
        ? String(body?.description ?? "").trim() || null
        : undefined;
    const parsedMemberUserIds = body?.memberUserIds !== undefined
      ? parseMemberUserIds(body.memberUserIds)
      : null;
    if (parsedMemberUserIds?.error) {
      return NextResponse.json({ error: parsedMemberUserIds.error }, { status: 400 });
    }
    const memberUserIds = parsedMemberUserIds?.memberUserIds;
    if (memberUserIds !== undefined) {
      const memberValidationError = validateProjectMemberUserIds(memberUserIds);
      if (memberValidationError) {
        return NextResponse.json({ error: memberValidationError }, { status: 400 });
      }
    }

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Valid project ID is required" }, { status: 400 });
    }

    const project = db
      .prepare("SELECT id, user_id, name FROM projects WHERE id = ?")
      .get(projectId) as { id: number; user_id: number; name: string } | undefined;
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }
    if (
      typeof body?.azureProjectUrl === "string" &&
      body.azureProjectUrl.trim() &&
      !normalizeAzureDevOpsProjectSettings({ projectUrl: body.azureProjectUrl, pat: "" })
    ) {
      return NextResponse.json(
        { error: "A valid Azure DevOps project URL is required" },
        { status: 400 }
      );
    }

    if (body?.azureProjectUrl !== undefined) {
      const nextProvider =
        typeof body.azureProjectUrl === "string" && body.azureProjectUrl.trim()
          ? "azure_devops"
          : "none";
      const providerError = assertProviderCanChange(projectId, nextProvider);
      if (providerError) {
        return NextResponse.json({ error: providerError }, { status: 400 });
      }
    }

    if (name !== undefined) {
      const duplicate = db
        .prepare("SELECT id FROM projects WHERE lower(name) = lower(?) AND id != ?")
        .get(name, projectId) as { id: number } | undefined;
      if (duplicate) {
        return NextResponse.json({ error: "A project with this name already exists" }, { status: 409 });
      }

      db.prepare("UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(name, projectId);
    }

    if (description !== undefined) {
      db.prepare(
        "UPDATE projects SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(description, projectId);
    }

    if (memberUserIds !== undefined) {
      replaceProjectMembers(projectId, memberUserIds, userId);
    }

    applyAzureProjectUrl(projectId, body?.azureProjectUrl);

    return NextResponse.json(getProjectResponse(projectId));
  } catch (error) {
    if (error instanceof Error && error.message === "A valid Azure DevOps project URL is required") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;
    const projectId = Number(request.nextUrl.searchParams.get("id"));

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "Valid project ID is required" }, { status: 400 });
    }

    const project = db
      .prepare("SELECT id, user_id FROM projects WHERE id = ?")
      .get(projectId) as { id: number; user_id: number } | undefined;
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const result = db
      .prepare("DELETE FROM projects WHERE id = ?")
      .run(projectId);
    if (result.changes === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    clearDefaultProjectReferences(projectId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
