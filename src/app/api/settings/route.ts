export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Settings, AzureDevOpsSettings, LMStudioSettings } from '@/types';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';
import { canManageProject } from '@/lib/authorization';

const redactAzureDevOpsSettings = (
  value: AzureDevOpsSettings
): AzureDevOpsSettings & { has_pat: boolean } => ({
  ...value,
  pat: value.pat ? "" : value.pat,
  has_pat: Boolean(value.pat),
});

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
      const canManageSensitiveSettings =
        key !== "azure_devops" || canManageProject(userId, projectId);
      if (!canManageSensitiveSettings) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const setting = key === "azure_devops"
        ? (db
            .prepare("SELECT id, ? as user_id, project_id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?")
            .get(userId, key, projectId) as Settings | undefined)
        : (db
            .prepare('SELECT * FROM settings WHERE key = ? AND user_id = ? AND project_id = ?')
            .get(key, userId, projectId) as Settings | undefined);
      
      if (!setting) {
        return NextResponse.json({ error: 'Setting not found' }, { status: 404 });
      }

      // Parse JSON value if it's Azure DevOps settings
      if (key === 'azure_devops') {
        const value = parseAzureDevOpsSettings(setting.value);
        if (value) {
          return NextResponse.json({ ...setting, value: redactAzureDevOpsSettings(value) });
        }
        return NextResponse.json(setting);
      }

      // Parse JSON value if it's LM Studio settings
      if (key === 'lm_studio') {
        try {
          const value = JSON.parse(setting.value) as LMStudioSettings;
          return NextResponse.json({ ...setting, value });
        } catch {
          return NextResponse.json(setting);
        }
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

    // Stringify value if it's an object
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

    // Upsert setting
    if (key === "azure_devops") {
      if (!canManageProject(userId, projectId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const nextValue = typeof value === 'object' && value !== null
        ? { ...(value as AzureDevOpsSettings) }
        : parseAzureDevOpsSettings(String(value));

      if (!nextValue) {
        return NextResponse.json({ error: 'Invalid Azure DevOps settings' }, { status: 400 });
      }

      if (!nextValue.pat) {
        const existing = db
          .prepare("SELECT value FROM project_settings WHERE key = ? AND project_id = ?")
          .get(key, projectId) as { value: string } | undefined;
        const existingValue = existing ? parseAzureDevOpsSettings(existing.value) : null;
        if (existingValue?.pat) {
          nextValue.pat = existingValue.pat;
        }
      }

      db.prepare(`
        INSERT INTO project_settings (project_id, key, value, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(project_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `).run(projectId, key, JSON.stringify(nextValue));
    } else {
      const stmt = db.prepare(`
        INSERT INTO settings (user_id, project_id, key, value, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, project_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `);
      stmt.run(userId, projectId, key, stringValue);
    }

    const setting = key === "azure_devops"
      ? (db
          .prepare("SELECT id, ? as user_id, project_id, key, value, created_at, updated_at FROM project_settings WHERE key = ? AND project_id = ?")
          .get(userId, key, projectId) as Settings)
      : (db
          .prepare('SELECT * FROM settings WHERE key = ? AND user_id = ? AND project_id = ?')
          .get(key, userId, projectId) as Settings);

    if (key === "azure_devops") {
      const value = parseAzureDevOpsSettings(setting.value);
      if (value) {
        return NextResponse.json({ ...setting, value: redactAzureDevOpsSettings(value) });
      }
    }

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

    if (key === "azure_devops" && !canManageProject(userId, projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
