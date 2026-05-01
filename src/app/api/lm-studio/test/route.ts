export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { Settings } from '@/types';
import { safeServerFetch, validateHttpUrlForServerFetch } from '@/lib/safe-fetch';
import { getRequestProjectId, getRequestUserId } from '@/lib/user-context';

interface LMStudioSettings {
  endpoint: string;
  model: string;
}

interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

interface LMStudioModelsResponse {
  data: LMStudioModel[];
}

async function getLMStudioSettings(userId: number, projectId: number): Promise<LMStudioSettings | null> {
  try {
    const setting = db
      .prepare('SELECT * FROM settings WHERE key = ? AND user_id = ? AND project_id = ?')
      .get('lm_studio', userId, projectId) as Settings | undefined;
    if (!setting) return null;
    return JSON.parse(setting.value) as LMStudioSettings;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json();
    const { endpoint } = body;

    // Use provided endpoint or get from settings
    const targetEndpoint = endpoint || (await getLMStudioSettings(userId, projectId))?.endpoint;

    if (!targetEndpoint) {
      return NextResponse.json(
        { error: 'LM Studio endpoint is required' },
        { status: 400 }
      );
    }

    const endpointUrl = await validateHttpUrlForServerFetch(targetEndpoint, {
      allowLoopbackOnly: true,
    });
    const modelsUrl = new URL('/v1/models', endpointUrl);

    // Test connection by fetching models
    const response = await safeServerFetch(modelsUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }, {
      allowLoopbackOnly: true,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `LM Studio returned ${response.status}: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json() as LMStudioModelsResponse;
    const models = data.data?.map((m) => m.id) || [];

    return NextResponse.json({
      success: true,
      models,
      message: models.length > 0 
        ? `Connection successful! Available models: ${models.join(', ')}`
        : 'Connection successful! No models loaded.',
    });
  } catch (error) {
    console.error('LM Studio test error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error 
          ? `Connection failed: ${error.message}` 
          : 'Failed to connect to LM Studio. Make sure it is running.',
      },
      { status: 500 }
    );
  }
}
