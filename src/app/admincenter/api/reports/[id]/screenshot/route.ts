import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAdmin } from '@/auth';
import { db, schema } from '@/db';
import { readArchive } from '@/lib/storage';

/**
 * `GET /admincenter/api/reports/[id]/screenshot`：後台讀取任一筆問題回報
 * 的截圖，供「問題回報」頁的燈箱使用。
 *
 * 只在後台網域可用（`src/proxy.ts` 已把 `/admincenter` 以外的路徑擋在
 * 後台網域之外），這裡再核對登入狀態：Route Handler 是可被直接呼叫的
 * GET 端點，不能只靠畫面上有沒有渲染縮圖來把關（比照
 * `admincenter/api/export/analyses/route.ts` 的做法）。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: '未登入或不在白名單內，無法查看。' }, { status: 401 });
  }

  const { id } = await params;

  const rows = await db
    .select({ screenshotPath: schema.reports.screenshotPath })
    .from(schema.reports)
    .where(eq(schema.reports.id, id))
    .limit(1);

  const row = rows[0];
  if (!row || !row.screenshotPath) {
    return NextResponse.json({ error: '找不到指定的截圖。' }, { status: 404 });
  }

  const data = await readArchive(row.screenshotPath);

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
