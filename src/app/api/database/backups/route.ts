export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import { createDatabaseBackup, deleteDatabaseBackup, listDatabaseBackups } from '@/lib/db';
import { requireAdminUser } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const backups = listDatabaseBackups();
    return NextResponse.json(backups);
  } catch (error) {
    console.error('Database backup list error:', error);
    return NextResponse.json({ error: 'Failed to list database backups' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const body = await request.json().catch(() => ({}));
    const fileName = typeof body.fileName === 'string' ? body.fileName : undefined;

    const backup = await createDatabaseBackup(fileName);
    return NextResponse.json(backup, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create database backup';
    const status = message.includes('already exists') || message.includes('Invalid') ? 400 : 500;

    console.error('Database backup create error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = requireAdminUser(request);
    if ("response" in admin) return admin.response;

    const searchParams = request.nextUrl.searchParams;
    const fileName = searchParams.get('fileName');

    if (!fileName) {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }

    deleteDatabaseBackup(fileName);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete database backup';
    const status = message.includes('not found') || message.includes('Invalid') ? 400 : 500;

    console.error('Database backup delete error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
