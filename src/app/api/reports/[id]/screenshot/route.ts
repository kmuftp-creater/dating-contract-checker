import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { db, schema } from '@/db';
import { errorResponse, getOrCreateClientId, setClientCookie } from '@/lib/http';
import { readArchive } from '@/lib/storage';

/**
 * `GET /api/reports/[id]/screenshot`：讀回自己送出的問題回報所附的截圖。
 *
 * 一律用瀏覽器識別碼比對，比照 `src/lib/analyses.ts` 的 `getForClient`：
 * 查到別人的回報，或這筆回報沒有附截圖，一律回 404，不洩漏是否存在。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { clientId, isNew } = getOrCreateClientId(request);

  const rows = await db
    .select({ screenshotPath: schema.reports.screenshotPath })
    .from(schema.reports)
    .where(and(eq(schema.reports.id, id), eq(schema.reports.clientId, clientId)))
    .limit(1);

  const row = rows[0];
  if (!row || !row.screenshotPath) {
    return errorResponse('not_found', '找不到指定的截圖。', 404);
  }

  const data = await readArchive(row.screenshotPath);

  const response = new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600',
    },
  });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}
