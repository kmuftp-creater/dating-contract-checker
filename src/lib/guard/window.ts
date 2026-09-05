import 'server-only';

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import { db, schema } from '@/db';

/**
 * 滑動視窗計數。
 *
 * 對應設計文件第三章第 3 節：規則的計數放在資料庫的滑動視窗表
 * （`ip_windows`），以「分鐘整點」為桶，不另外架 Redis。
 */

/** 事件種類：上傳、分析、被拒（含封鎖、暫停、逾時、驗證失敗等一切被擋下的請求）。 */
export type WindowEventKind = 'upload' | 'analyze' | 'rejected';

/** 把時間戳截到分鐘整點（去除秒與毫秒），做為桶的鍵。 */
function bucketMinute(date: Date): Date {
  const bucket = new Date(date.getTime());
  bucket.setSeconds(0, 0);
  return bucket;
}

/**
 * 記錄一次事件。
 *
 * 用 `onConflictDoUpdate` 直接在資料庫端把對應欄位加一，不先查再寫：
 * 併發下多個請求同時命中同一個分鐘桶時，靠資料庫的 upsert 保證每一次
 * 呼叫都確實加到，不會因為「讀到舊值後才寫回」而漏算。
 */
export async function recordEvent(ip: string, kind: WindowEventKind): Promise<void> {
  const bucket = bucketMinute(new Date());

  const baseValues = {
    ip,
    bucketMinute: bucket,
    uploadCount: kind === 'upload' ? 1 : 0,
    analyzeCount: kind === 'analyze' ? 1 : 0,
    rejectedCount: kind === 'rejected' ? 1 : 0,
  };

  if (kind === 'upload') {
    await db
      .insert(schema.ipWindows)
      .values(baseValues)
      .onConflictDoUpdate({
        target: [schema.ipWindows.ip, schema.ipWindows.bucketMinute],
        set: { uploadCount: sql`${schema.ipWindows.uploadCount} + 1` },
      });
    return;
  }

  if (kind === 'analyze') {
    await db
      .insert(schema.ipWindows)
      .values(baseValues)
      .onConflictDoUpdate({
        target: [schema.ipWindows.ip, schema.ipWindows.bucketMinute],
        set: { analyzeCount: sql`${schema.ipWindows.analyzeCount} + 1` },
      });
    return;
  }

  await db
    .insert(schema.ipWindows)
    .values(baseValues)
    .onConflictDoUpdate({
      target: [schema.ipWindows.ip, schema.ipWindows.bucketMinute],
      set: { rejectedCount: sql`${schema.ipWindows.rejectedCount} + 1` },
    });
}

/** 統計某個 IP 最近 N 秒內某種事件的累計數（跨分鐘桶加總）。 */
export async function countRecent(
  ip: string,
  kind: WindowEventKind,
  seconds: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - seconds * 1000);
  const column =
    kind === 'upload'
      ? schema.ipWindows.uploadCount
      : kind === 'analyze'
        ? schema.ipWindows.analyzeCount
        : schema.ipWindows.rejectedCount;

  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${column}), 0)` })
    .from(schema.ipWindows)
    .where(and(eq(schema.ipWindows.ip, ip), gte(schema.ipWindows.bucketMinute, cutoff)));

  return Number(rows[0]?.total ?? 0);
}

/** 清掉舊桶，供排程呼叫，避免 `ip_windows` 表無限成長。 */
export async function pruneOldWindows(olderThanHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const result = await db.delete(schema.ipWindows).where(lt(schema.ipWindows.bucketMinute, cutoff));
  return result.rowCount ?? 0;
}
