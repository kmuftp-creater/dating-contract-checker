import 'server-only';

import { and, desc, eq, gte } from 'drizzle-orm';

import { db, schema } from '@/db';

import type { ChainErrorCategory, ChainLayerId } from './chain';

/**
 * AI 備援鏈嘗試事件的寫入與統計查詢。
 *
 * 資料表定義見 `src/db/schema.ts` 的 `aiChainAttempts`；寫入呼叫端是
 * `analyze.ts` 依鏈執行時的每一次實際嘗試，查詢呼叫端是後台「備援鏈
 * 狀態」頁面。
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface RecordChainAttemptInput {
  layerId: ChainLayerId;
  ok: boolean;
  /** 成功時為 null。 */
  errorCategory: ChainErrorCategory | null;
  latencyMs: number;
}

/** 寫一筆嘗試事件。 */
export async function recordChainAttempt(input: RecordChainAttemptInput): Promise<void> {
  await db.insert(schema.aiChainAttempts).values({
    layerId: input.layerId,
    ok: input.ok,
    errorCategory: input.errorCategory,
    latencyMs: input.latencyMs,
  });
}

export interface ChainLayerStats {
  /** 近 30 天完成（成功）次數。 */
  completed30d: number;
  /** 近 30 天失敗次數。 */
  failed30d: number;
  /** 最後一次事件（不限 30 天內），從未有過紀錄時為 null。 */
  lastEvent: { createdAt: Date; ok: boolean; errorCategory: ChainErrorCategory | null } | null;
}

/** 查每一層近 30 天的完成／失敗數與最後一次事件，供後台表格顯示。 */
export async function getChainLayerStats(
  layerIds: ChainLayerId[],
): Promise<Record<string, ChainLayerStats>> {
  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const result: Record<string, ChainLayerStats> = {};

  for (const layerId of layerIds) {
    const [completedRows, failedRows, lastRows] = await Promise.all([
      db
        .select({ id: schema.aiChainAttempts.id })
        .from(schema.aiChainAttempts)
        .where(
          and(
            eq(schema.aiChainAttempts.layerId, layerId),
            eq(schema.aiChainAttempts.ok, true),
            gte(schema.aiChainAttempts.createdAt, since),
          ),
        ),
      db
        .select({ id: schema.aiChainAttempts.id })
        .from(schema.aiChainAttempts)
        .where(
          and(
            eq(schema.aiChainAttempts.layerId, layerId),
            eq(schema.aiChainAttempts.ok, false),
            gte(schema.aiChainAttempts.createdAt, since),
          ),
        ),
      db
        .select({
          createdAt: schema.aiChainAttempts.createdAt,
          ok: schema.aiChainAttempts.ok,
          errorCategory: schema.aiChainAttempts.errorCategory,
        })
        .from(schema.aiChainAttempts)
        .where(eq(schema.aiChainAttempts.layerId, layerId))
        .orderBy(desc(schema.aiChainAttempts.createdAt))
        .limit(1),
    ]);

    result[layerId] = {
      completed30d: completedRows.length,
      failed30d: failedRows.length,
      lastEvent: lastRows.length > 0 ? lastRows[0] : null,
    };
  }

  return result;
}
