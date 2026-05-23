export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Settings, AzureDevOpsSettings } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';
import { canManageProject, isAdminUser } from '@/lib/authorization';
import {
  AI_PROVIDER_SETTING_KEY,
  deleteAiProviderSettings,
  getAiProviderSettings,
  parseAiProviderSettings,
  upsertAiProviderSettings,
} from '@/lib/ai-provider-settings';
import {
  deleteAzureDevOpsUserPat,
  getAzureDevOpsPublicSettings,
  upsertAzureDevOpsProjectSettings,
  upsertAzureDevOpsUserPat,
} from '@/lib/azure-devops/settings';

const parseAzureDevOpsSettings = (value: string): AzureDevOpsSettings | null => {
  try {
    return JSON.parse(value) as AzureDevOpsSettings;
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get('key');

    if (key) {
      if (key === "azure_devops") {
        const value = getAzureDevOpsPublicSettings(userId, projectId);
        if (!value) {
          return NextResponse.json({ error: 'Setting not found' }, { status: 404 });
        }

        return NextResponse.json({
          id: 0,
          user_id: userId,
          project_id: projectId,
          key,
          value,
          created_at: null,
          updated_at: null,
        });
      }

      if (key === AI_PROVIDER_SETTING_KEY || key === "lm_studio") {
        if (!isAdminUser(userId)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const value = getAiProviderSettings();
        if (!value) {
          return NextResponse.json({ error: 'Setting not found' }, { status: 404 });
        }

        return NextResponse.json({
          id: 0,
          user_id: null,
          project_id: null,
          key: AI_PROVIDER_SETTING_KEY,
          value,
          created_at: null,
          updated_at: null,
        });
      }

      const setting = db
        .prepare('SELECT * FROM settings WHERE key = ? AND user_id = ? AND project_id = ?')
        .get(key, userId, projectId) as Settings | undefined;
      
      if (!setting) {
        return NextResponse.json({ error: 'Setting not found' }, { status: 404 });
      }

      return NextResponse.json(setting);
    }

    // Return all settings
    const settings = db
      .prepare('SELECT * FROM settings WHERE user_id = ? AND project_id = ? ORDER BY key')
      .all(userId, projectId) as Settings[];
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: 'Key and value are required' },
        { status: 400 }
      );
    }

    // Upsert setting
    if (key === "azure_devops") {
      const nextValue = typeof value === 'object' && value !== null
        ? { ...(value as AzureDevOpsSettings) }
        : parseAzureDevOpsSettings(String(value));

      if (!nextValue) {
        return NextResponse.json({ error: 'Invalid Azure DevOps settings' }, { status: 400 });
      }

      const canManageCurrentProject = canManageProject(userId, projectId);
      const includesProjectSettings =
        Object.prototype.hasOwnProperty.call(nextValue, "organization") ||
        Object.prototype.hasOwnProperty.call(nextValue, "project");

      if (includesProjectSettings && !canManageCurrentProject) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (includesProjectSettings) {
        const organization = nextValue.organization?.trim() ?? "";
        const project = nextValue.project?.trim() ?? "";

        if (!organization || !project) {
          return NextResponse.json(
            { error: "Organization and project are required" },
            { status: 400 }
          );
        }

        upsertAzureDevOpsProjectSettings(projectId, { organization, project });
      }

      if (typeof nextValue.pat === "string" && nextValue.pat.trim()) {
        upsertAzureDevOpsUserPat(userId, nextValue.pat);
      }

      const redactedValue = getAzureDevOpsPublicSettings(userId, projectId);
      return NextResponse.json({
        id: 0,
        user_id: userId,
        project_id: projectId,
        key,
        value: redactedValue,
        created_at: null,
        updated_at: null,
      });
    } else if (key === AI_PROVIDER_SETTING_KEY || key === "lm_studio") {
      if (!isAdminUser(userId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const nextValue = parseAiProviderSettings(value);
      if (!nextValue) {
        return NextResponse.json({ error: "Invalid AI provider settings" }, { status: 400 });
      }

      if (!nextValue.baseUrl || !nextValue.model) {
        return NextResponse.json(
          { error: "Provider base URL and model are required" },
          { status: 400 }
        );
      }

      upsertAiProviderSettings(nextValue);

      return NextResponse.json({
        id: 0,
        user_id: null,
        project_id: null,
        key: AI_PROVIDER_SETTING_KEY,
        value: getAiProviderSettings(),
        created_at: null,
        updated_at: null,
      });
    } else {
      // Stringify value if it's an object
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const stmt = db.prepare(`
        INSERT INTO settings (user_id, project_id, key, value, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, project_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(userId, projectId, key, stringValue);
    }

    const setting = db
      .prepare('SELECT * FROM settings WHERE key = ? AND user_id = ? AND project_id = ?')
      .get(key, userId, projectId) as Settings;

    return NextResponse.json(setting);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to save setting' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json(
        { error: 'Key is required' },
        { status: 400 }
      );
    }

    if (key === "azure_devops" && request.nextUrl.searchParams.get("credential") === "pat") {
      deleteAzureDevOpsUserPat(userId);
      return NextResponse.json({ success: true });
    }

    if (key === "azure_devops" && !canManageProject(userId, projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (key === AI_PROVIDER_SETTING_KEY || key === "lm_studio") {
      if (!isAdminUser(userId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      deleteAiProviderSettings();
      return NextResponse.json({ success: true });
    }

    const result = key === "azure_devops"
      ? db.prepare("DELETE FROM project_settings WHERE key = ? AND project_id = ?").run(key, projectId)
      : db.prepare('DELETE FROM settings WHERE key = ? AND user_id = ? AND project_id = ?').run(key, userId, projectId);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Setting not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to delete setting' },
      { status: 500 }
    );
  }
}
