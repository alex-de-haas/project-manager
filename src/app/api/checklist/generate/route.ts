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

interface ChecklistGenerationRequest {
  task_id: number;
  text: string;
}

interface LMStudioMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LMStudioResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
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

async function generateChecklistFromAI(text: string, settings: LMStudioSettings): Promise<string[]> {
  const systemPrompt = `You are a helpful assistant that analyzes text and extracts actionable checklist items.
Your task is to:
1. Read the provided text carefully
2. Extract clear, actionable tasks or steps
3. Return ONLY a JSON array of strings, where each string is a checklist item
4. Keep items concise but clear
5. Order items logically (by importance or sequence)
6. Do not include any other text, only the JSON array

Example output format:
["Task 1", "Task 2", "Task 3"]`;

  const userPrompt = `Please analyze the following text and extract a checklist of actionable items:

${text}

Return ONLY a JSON array of checklist items.`;

  const messages: LMStudioMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const endpointUrl = await validateHttpUrlForServerFetch(settings.endpoint, {
    allowLoopbackOnly: true,
  });
  const completionsUrl = new URL('/v1/chat/completions', endpointUrl);

  const response = await safeServerFetch(completionsUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.3,
      max_tokens: 2048,
    }),
  }, {
    allowLoopbackOnly: true,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LM Studio API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as LMStudioResponse;
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from AI model');
  }

  // Try to parse the JSON array from the response
  // The model might include markdown code blocks, so we need to clean it
  let cleanContent = content.trim();
  
  // Remove markdown code blocks if present
  if (cleanContent.startsWith('```json')) {
    cleanContent = cleanContent.slice(7);
  } else if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.slice(3);
  }
  if (cleanContent.endsWith('```')) {
    cleanContent = cleanContent.slice(0, -3);
  }
  cleanContent = cleanContent.trim();

  try {
    const items = JSON.parse(cleanContent);
    if (!Array.isArray(items)) {
      throw new Error('Response is not an array');
    }
    return items.map(item => String(item).trim()).filter(item => item.length > 0);
  } catch (parseError) {
    // If JSON parsing fails, try to extract items line by line
    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Remove common prefixes like "- ", "* ", "1. ", etc.
        return line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim();
      })
      .filter(line => line.length > 0 && !line.startsWith('[') && !line.startsWith(']'));
    
    if (lines.length > 0) {
      return lines;
    }
    
    throw new Error('Could not parse checklist items from AI response');
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const projectId = getRequestProjectId(request, userId);
    const body = await request.json() as ChecklistGenerationRequest;
    const { task_id, text } = body;

    if (!task_id) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Text to analyze is required' },
        { status: 400 }
      );
    }

    const task = db
      .prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ? AND project_id = ?')
      .get(task_id, userId, projectId) as { id: number } | undefined;
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Get LM Studio settings
    const settings = await getLMStudioSettings(userId, projectId);
    if (!settings || !settings.endpoint) {
      return NextResponse.json(
        { error: 'LM Studio settings not configured. Please configure them in Settings.' },
        { status: 400 }
      );
    }

    // Generate checklist items from AI
    const checklistItems = await generateChecklistFromAI(text, settings);

    if (checklistItems.length === 0) {
      return NextResponse.json(
        { error: 'No checklist items could be extracted from the text' },
        { status: 400 }
      );
    }

    // Get the current max display_order for this task
    const maxOrder = db.prepare(
      'SELECT MAX(display_order) as max_order FROM checklist_items WHERE task_id = ? AND user_id = ? AND project_id = ?'
    ).get(task_id, userId, projectId) as { max_order: number | null };
    let currentOrder = (maxOrder.max_order ?? -1) + 1;

    // Insert all checklist items
    const insertStmt = db.prepare(
      'INSERT INTO checklist_items (user_id, project_id, task_id, title, display_order) VALUES (?, ?, ?, ?, ?)'
    );

    const insertedIds: number[] = [];
    for (const title of checklistItems) {
      const result = insertStmt.run(userId, projectId, task_id, title, currentOrder);
      insertedIds.push(result.lastInsertRowid as number);
      currentOrder++;
    }

    return NextResponse.json(
      { 
        message: `Successfully created ${checklistItems.length} checklist items`,
        items: checklistItems,
        ids: insertedIds
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('AI generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate checklist from AI' },
      { status: 500 }
    );
  }
}
