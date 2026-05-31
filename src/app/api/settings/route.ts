export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Settings, AzureDevOpsSettings } from '@/types';
import {
  getRequestProjectId,
  getRequestUserId,
  projectContextErrorResponse,
} from '@/lib/user-context';
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
  createAzureDevOpsConnectionContext,
  getAzureDevOpsAuthenticatedUser,
  getAzureDevOpsPublicSettings,
  getAzureDevOpsSettingsForUser,
  normalizeAzureDevOpsProjectSettings,
  upsertAzureDevOpsProjectSettings,
  upsertAzureDevOpsUserIdentity,
  upsertAzureDevOpsUserPat,
  isAzureDevOpsConfigProblem,
} from '@/lib/azure-devops/settings';
import {
  DEFAULT_DAY_LENGTH_SETTING_KEY,
  getModuleDefaultDayLength,
  parseDefaultDayLength,
} from '@/lib/work-schedule';

const parseAzureDevOpsSettings = (value: string): Partial<AzureDevOpsSettings> | null => {
  try {
    return JSON.parse(value) as Partial<AzureDevOpsSettings>;
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get('key');

    if (key) {
      const projectId =
        key === AI_PROVIDER_SETTING_KEY || key === "lm_studio"
          ? null
          : getRequestProjectId(request, userId);
      if (key === "azure_devops") {
        const value = getAzureDevOpsPublicSettings(userId, projectId!);
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

      if (key === DEFAULT_DAY_LENGTH_SETTING_KEY) {
        const setting = db
          .prepare('SELECT * FROM settings WHERE key = ? AND user_id = ? AND project_id = ?')
          .get(key, userId, projectId) as Settings | undefined;

        const storedValue = parseDefaultDayLength(setting?.value);

        if (setting && storedValue !== null) {
          return NextResponse.json({
            ...setting,
            value: String(storedValue),
          });
        }

        return NextResponse.json({
          id: 0,
          user_id: userId,
          project_id: projectId,
          key,
          value: String(getModuleDefaultDayLength()),
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

    const projectId = getRequestProjectId(request, userId);
    // Return all settings
    const settings = db
      .prepare('SELECT * FROM settings WHERE user_id = ? AND project_id = ? ORDER BY key')
      .all(userId, projectId) as Settings[];
    return NextResponse.json(settings);
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

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
      const projectId = getRequestProjectId(request, userId);
      const nextValue = typeof value === 'object' && value !== null
        ? { ...(value as AzureDevOpsSettings) }
        : parseAzureDevOpsSettings(String(value));

      if (!nextValue) {
        return NextResponse.json({ error: 'Invalid Azure DevOps settings' }, { status: 400 });
      }

      const canManageCurrentProject = canManageProject(userId, projectId);
      const includesProjectSettings =
        Object.prototype.hasOwnProperty.call(nextValue, "projectUrl") ||
        Object.prototype.hasOwnProperty.call(nextValue, "organization") ||
        Object.prototype.hasOwnProperty.call(nextValue, "project");

      if (includesProjectSettings && !canManageCurrentProject) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (includesProjectSettings) {
        const projectSettings = normalizeAzureDevOpsProjectSettings(nextValue);
        if (!projectSettings) {
          return NextResponse.json(
            { error: "A valid Azure DevOps project URL is required" },
            { status: 400 }
          );
        }

        upsertAzureDevOpsProjectSettings(projectId, projectSettings);
      }

      if (typeof nextValue.pat === "string" && nextValue.pat.trim()) {
        upsertAzureDevOpsUserPat(userId, nextValue.pat);
        const settingsForUser = getAzureDevOpsSettingsForUser(userId, projectId);
        if (!isAzureDevOpsConfigProblem(settingsForUser)) {
          try {
            const { connection } =
              await createAzureDevOpsConnectionContext(settingsForUser);
            const identity = await getAzureDevOpsAuthenticatedUser(connection);
            if (!identity) {
              throw new Error("Azure DevOps identity not found");
            }
            upsertAzureDevOpsUserIdentity(userId, identity);
          } catch (identityError) {
            console.warn("Failed to resolve Azure DevOps user identity:", identityError);
          }
        }
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
      const projectId = getRequestProjectId(request, userId);
      let stringValue: string;
      if (key === DEFAULT_DAY_LENGTH_SETTING_KEY) {
        const numericValue = parseDefaultDayLength(value);
        if (numericValue === null) {
          return NextResponse.json(
            { error: "Default day length must be between 0.5 and 24 hours" },
            { status: 400 }
          );
        }

        if (projectId <= 0) {
          return NextResponse.json(
            { error: "Select or create a project before setting default day length" },
            { status: 400 }
          );
        }

        stringValue = String(numericValue);
      } else {
        // Stringify value if it's an object
        stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      }

      const stmt = db.prepare(`
        INSERT INTO settings (user_id, project_id, key, value, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, project_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(userId, projectId, key, stringValue);

      const setting = db
        .prepare('SELECT * FROM settings WHERE key = ? AND user_id = ? AND project_id = ?')
        .get(key, userId, projectId) as Settings;

      return NextResponse.json(setting);
    }
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

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
      db.prepare(
        "DELETE FROM provider_user_identities WHERE user_id = ? AND provider = 'azure_devops'"
      ).run(userId);
      db.prepare(
        "UPDATE users SET app_display_name = name, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(userId);
      return NextResponse.json({ success: true });
    }

    const projectId =
      key === AI_PROVIDER_SETTING_KEY || key === "lm_studio"
        ? null
        : getRequestProjectId(request, userId);

    if (key === "azure_devops" && !canManageProject(userId, projectId!)) {
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
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to delete setting' },
      { status: 500 }
    );
  }
}
