import 'server-only';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db, schema } from '@/db';

/**
 * 瀏覽器識別碼。
 *
 * 對應設計文件第二章第 3、5 節：沒有登入，用瀏覽器識別碼（首次造訪發放，
 * 存在 cookie 與 localStorage）當作「一位使用者」的其中一把尺，也是歷史
 * 紀錄的查詢鍵。
 */

export type ClientRow = typeof schema.clients.$inferSelect;

/**
 * 確保瀏覽器識別碼存在：存在就更新 `lastSeen`，不存在就建立一筆。
 *
 * 用 `onConflictDoUpdate` 一次到位，不先查再寫：併發下同一個新
 * clientId 同時送出第一次請求時，不會因為「先查不存在、再各自嘗試
 * insert」而有一邊撞到唯一鍵錯誤。衝突時只更新 `lastSeen`，
 * `firstIp` 與 `userAgent` 保留首次造訪時的值。
 */
export async function ensureClient(
  clientId: string,
  ip: string,
  userAgent: string | null,
  country: string | null = null,
): Promise<ClientRow> {
  const now = new Date();

  const [row] = await db
    .insert(schema.clients)
    .values({
      id: clientId,
      firstIp: ip,
      userAgent,
      country,
      firstSeen: now,
      lastSeen: now,
    })
    .onConflictDoUpdate({
      target: schema.clients.id,
      // 國別只在原本沒有值時補上，不覆蓋既有紀錄：
      // 同一個瀏覽器換到不同網路時，第一次看到的來源比較有代表性。
      set: { lastSeen: now, country: sql`coalesce(${schema.clients.country}, ${country})` },
    })
    .returning();

  return row;
}

/** 產生新的瀏覽器識別碼，供前端首次造訪時發放。 */
export function newClientId(): string {
  return randomUUID();
}
