export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import type { DayOff } from '@/types';
import { getRequestUserId } from '@/lib/user-context';

// GET - Fetch all days off or filter by date range
export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const allUsers = searchParams.get('allUsers') === 'true';

    let query = allUsers
      ? 'SELECT day_offs.*, users.name AS user_name FROM day_offs JOIN users ON users.id = day_offs.user_id WHERE 1 = 1'
      : 'SELECT * FROM day_offs WHERE user_id = ?';
    const params: Array<string | number> = allUsers ? [] : [userId];

    if (startDate && endDate) {
      query += ' AND date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    query += allUsers ? ' ORDER BY date ASC, users.name ASC' : ' ORDER BY date ASC';

    const stmt = db.prepare(query);
    const dayOffs = params.length > 0 ? stmt.all(...params) : stmt.all();

    return NextResponse.json(dayOffs);
  } catch (error) {
    console.error('Error fetching days off:', error);
    return NextResponse.json(
      { error: 'Failed to fetch days off' },
      { status: 500 }
    );
  }
}

// POST - Create a new day off
export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const body = await request.json();
    const { date, description, isHalfDay = false } = body;

    if (!date) {
      return NextResponse.json(
        { error: 'Date is required' },
        { status: 400 }
      );
    }

    // Check if day off already exists for this date
    const existing = db.prepare('SELECT id FROM day_offs WHERE date = ? AND user_id = ?').get(date, userId);
    if (existing) {
      return NextResponse.json(
        { error: 'Day off already exists for this date' },
        { status: 409 }
      );
    }

    const stmt = db.prepare(
      'INSERT INTO day_offs (user_id, date, description, is_half_day) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(userId, date, description || null, isHalfDay ? 1 : 0);

    const newDayOff = db
      .prepare('SELECT * FROM day_offs WHERE id = ? AND user_id = ?')
      .get(result.lastInsertRowid, userId) as DayOff;

    return NextResponse.json(newDayOff, { status: 201 });
  } catch (error) {
    console.error('Error creating day off:', error);
    return NextResponse.json(
      { error: 'Failed to create day off' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a day off
export async function DELETE(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const date = searchParams.get('date');

    if (!id && !date) {
      return NextResponse.json(
        { error: 'Either id or date is required' },
        { status: 400 }
      );
    }

    let stmt;
    let result;

    if (id) {
      stmt = db.prepare('DELETE FROM day_offs WHERE id = ? AND user_id = ?');
      result = stmt.run(parseInt(id), userId);
    } else {
      stmt = db.prepare('DELETE FROM day_offs WHERE date = ? AND user_id = ?');
      result = stmt.run(date, userId);
    }

    if (result.changes === 0) {
      return NextResponse.json(
        { error: 'Day off not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting day off:', error);
    return NextResponse.json(
      { error: 'Failed to delete day off' },
      { status: 500 }
    );
  }
}
