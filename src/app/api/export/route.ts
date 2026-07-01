import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import db from '@/lib/db';
import type { Task } from '@/types';
import {
  getRequestProjectId,
  projectContextErrorResponse,
} from '@/lib/user-context';
import { getAuthenticatedUser } from '@/lib/auth';
import { getAzureDevOpsProjectSettings } from '@/lib/azure-devops/settings';
import { displayWorkItemStatus } from '@/lib/work-items';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;
    const projectId = getRequestProjectId(request, userId);
    const searchParams = request.nextUrl.searchParams;
    const mode = searchParams.get('mode') === 'week' ? 'week' : 'month';
    const month = searchParams.get('month'); // Legacy format: YYYY-MM

    let startDate = searchParams.get('startDate');
    let endDate = searchParams.get('endDate');

    // Backward-compatible fallback (month view only): derive the range from a YYYY-MM month.
    if ((!startDate || !endDate) && mode === 'month' && month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, monthNum] = month.split('-');
      startDate = `${year}-${monthNum}-01`;
      endDate = `${year}-${monthNum}-31`;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDate || !endDate || !dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return NextResponse.json(
        { error: 'Valid startDate and endDate parameters in YYYY-MM-DD format are required' },
        { status: 400 }
      );
    }

    // Fetch Azure DevOps settings for building links
    const azureSettings = getAzureDevOpsProjectSettings(projectId);

    // Fetch tasks that overlap with the selected period
    const tasks = db.prepare(`
      SELECT
        wi.*,
        tti.display_order AS display_order,
        wi.assigned_user_id AS user_id,
        link.provider AS external_source,
        link.external_id
        FROM time_tracking_items tti
        INNER JOIN work_items wi
          ON wi.id = tti.work_item_id
          AND wi.project_id = tti.project_id
        LEFT JOIN work_item_external_links link ON link.work_item_id = wi.id
        WHERE tti.project_id = ?
          AND tti.user_id = ?
          AND wi.type IN ('task', 'bug')
          AND (
            (DATE(wi.created_at) <= ? AND (wi.completed_at IS NULL OR DATE(wi.completed_at) >= ?))
            OR EXISTS (
              SELECT 1
              FROM time_entries te_scope
              WHERE te_scope.work_item_id = wi.id
                AND te_scope.user_id = ?
                AND te_scope.date >= ?
                AND te_scope.date <= ?
              AND te_scope.hours > 0
            )
          )
        ORDER BY COALESCE(tti.display_order, 999999), tti.created_at ASC
    `).all(projectId, userId, endDate, startDate, userId, startDate, endDate) as Task[];

    const timeEntries = db.prepare(
      `SELECT te.work_item_id, te.date, te.hours
       FROM time_entries te
       INNER JOIN work_items wi ON wi.id = te.work_item_id
       WHERE wi.project_id = ?
         AND wi.type IN ('task', 'bug')
         AND te.user_id = ?
         AND te.date >= ?
         AND te.date <= ?`
    ).all(projectId, userId, startDate, endDate) as Array<{
      work_item_id: number;
      date: string;
      hours: number;
    }>;

    // Calculate total hours per task
    const taskHours = new Map<number, number>();
    timeEntries.forEach(entry => {
      const current = taskHours.get(entry.work_item_id) || 0;
      taskHours.set(entry.work_item_id, current + entry.hours);
    });

    // Filter out completed tasks (Resolved/Closed) without tracked time in the period
    const completedStatuses = ['Resolved', 'Closed'];
    const filteredTasks = tasks.filter(task => {
      const status = displayWorkItemStatus(task.status);
      if (completedStatuses.includes(status)) {
        const totalHours = taskHours.get(task.id) || 0;
        return totalHours > 0;
      }
      return true;
    });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Project Manager';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Work Items');

    // Define columns
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 15 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Title', key: 'title', width: 60 },
      { header: 'Total Hours', key: 'hours', width: 15 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows
    filteredTasks.forEach(task => {
      const totalHours = taskHours.get(task.id) || 0;
      
      // Build Azure DevOps link if applicable
      let link = '';
      if (task.external_source === 'azure_devops' && task.external_id && azureSettings?.organization && azureSettings?.project) {
        link = `https://dev.azure.com/${azureSettings.organization}/${azureSettings.project}/_workitems/edit/${task.external_id}`;
      }

      const displayId = task.external_id ? task.external_id.replace(/\.0$/, '') : '';

      const row = worksheet.addRow({
        id: displayId,
        type: task.type === 'bug' ? 'Bug' : 'Task',
        title: task.title,
        hours: totalHours,
      });

      // Make the ID a clickable link if we have an Azure DevOps link
      if (link) {
        const idCell = row.getCell('id');
        idCell.value = {
          text: displayId,
          hyperlink: link,
        };
        idCell.font = { color: { argb: 'FF0066CC' }, underline: true };
      }
    });

    // Add total row
    const totalHours = Array.from(taskHours.values()).reduce((sum, hours) => sum + hours, 0);
    const totalRow = worksheet.addRow({
      id: '',
      type: '',
      title: 'TOTAL',
      hours: totalHours,
    });
    totalRow.font = { bold: true };
    totalRow.getCell('title').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0F0F0' }
    };
    totalRow.getCell('hours').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF0F0F0' }
    };

    // Format hours column as number with 2 decimal places
    worksheet.getColumn('hours').numFmt = '0.00';

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Create response with Excel file
    const rawName = user.app_display_name || user.name || user.email || 'user';
    const safeName =
      rawName.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'user';

    let period: string;
    if (mode === 'week') {
      period = `${startDate}_${endDate}`;
    } else {
      // startDate is validated as YYYY-MM-DD, so split it to avoid timezone shifts.
      const [year, monthNum] = startDate.split('-');
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
      const monthName = monthNames[parseInt(monthNum, 10) - 1] || 'Unknown';
      period = `${monthName}-${year}`;
    }

    const filename = `${safeName}-${period}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const projectError = projectContextErrorResponse(error);
    if (projectError) return projectError;

    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Failed to export work items' },
      { status: 500 }
    );
  }
}
