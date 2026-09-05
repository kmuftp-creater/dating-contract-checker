import { NextResponse, type NextRequest } from 'next/server';

import { buildAnalysesCsv, type AnalysisRecordFilter } from '@/lib/admin/records';
import { requireAdmin } from '@/auth';
import type { AnalysisStatus } from '@/lib/types';

/**
 * 「使用紀錄」CSV 匯出。
 *
 * 只在後台網域可用（`src/proxy.ts` 已把 `/admincenter` 以外的路徑擋在後台
 * 網域之外），這裡只需要再核對登入狀態：Route Handler 是可被直接呼叫的
 * GET 端點，不能只靠畫面上有沒有渲染「匯出 CSV」連結來把關。
 */

function isStatus(value: string | null): value is AnalysisStatus {
  return value === 'queued' || value === 'running' || value === 'done' || value === 'failed';
}

/** 依 RFC 5987 編碼中文檔名，供 Content-Disposition 的 filename* 使用。 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: '未登入或不在白名單內，無法匯出。' }, { status: 401 });
  }

  const url = new URL(request.url);
  const statusRaw = url.searchParams.get('status');

  const filter: AnalysisRecordFilter = {
    ip: url.searchParams.get('ip')?.trim() || undefined,
    dateFrom: url.searchParams.get('dateFrom')?.trim() || undefined,
    dateTo: url.searchParams.get('dateTo')?.trim() || undefined,
    status: isStatus(statusRaw) ? statusRaw : undefined,
  };

  const csv = await buildAnalysesCsv(filter);
  // 加上 UTF-8 BOM，否則 Excel 開啟含中文的 CSV 會亂碼。
  const body = `﻿${csv}`;

  const today = new Date().toISOString().slice(0, 10);
  const filename = `使用紀錄-${today}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="export.csv"; filename*=UTF-8''${encodeRfc5987(filename)}`,
    },
  });
}
