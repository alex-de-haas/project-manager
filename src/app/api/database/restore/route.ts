export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { restoreDatabaseFromBackup } from '@/lib/db';
import { requireAdminUser } from '@/lib/authorization';

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const body = await request.json();
    const { fileName } = body;

    if (!fileName || typeof fileName !== 'string') {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }

    restoreDatabaseFromBackup(fileName);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to restore database backup';
    const status =
      message.includes('not found') || message.includes('Invalid') || message.includes('compatible')
        ? 400
        : 500;

    console.error('Database restore error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
