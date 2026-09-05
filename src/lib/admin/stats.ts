import 'server-only';

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { db, schema } from '@/db';
import { taipeiDateString } from '@/lib/guard/quota';
import { getSetting } from '@/lib/settings';
import type { IpStatus } from '@/lib/types';

/**
 * 後台儀表板統計查詢。
 *
 * 對應設計文件第三章第 2 節「儀表板（首頁）」。
 *
 * 費用估算的重要說明：`analyses.cost_estimate` 欄位在既有的分析流程
 * （`src/lib/analyses.ts` 的 `markDone`、`src/lib/worker/queue.ts`）裡
 * 從未被寫入，永遠是 null；這兩個檔案不在本次負責範圍內，不能修改。
 * 因此這裡的費用一律用輸入／輸出 token 數，依設計文件第四章第 3 節列出
 * 的公開牌價（gemini-2.5-flash：輸入每百萬美元 0.30、輸出每百萬美元
 * 2.50）換算估算，不是資料庫的實際存值；找不到對應模型牌價時套用同一組
 * 預設值（目前備援模型 `gemini-flash-paid` 也是 Gemini 家族，牌價相同）。
 */

const DEFAULT_PRICE_PER_MILLION = { input: 0.3, output: 2.5 };
const MODEL_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': DEFAULT_PRICE_PER_MILLION,
  'gemini-flash-paid': DEFAULT_PRICE_PER_MILLION,
};

/** 依模型別名與輸入輸出 token 數估算美元費用，模型未知時套用預設牌價。 */
export function estimateCostUsd(
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
): number {
  const price = (model && MODEL_PRICE_PER_MILLION[model]) || DEFAULT_PRICE_PER_MILLION;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return (input / 1_000_000) * price.input + (output / 1_000_000) * price.output;
}

/** 今日（台北時間 00:00 起 24 小時）的日期範圍，寫法對齊 `getTodayTokenTotal`。 */
function todayRangeTaipei(): { start: Date; end: Date } {
  const day = taipeiDateString();
  const start = new Date(`${day}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export interface TodayOverview {
  analysisCount: number;
  fileCount: number;
  inputTokens: number;
  outputTokens: number;
  costEstimateUsd: number;
  uniqueIpCount: number;
  uniqueClientCount: number;
}

/** 今日概況：分析次數、上傳檔案數、token、估算費用、獨立 IP／瀏覽器數。 */
export async function getTodayOverview(): Promise<TodayOverview> {
  const { start, end } = todayRangeTaipei();
  const inToday = and(gte(schema.analyses.createdAt, start), lt(schema.analyses.createdAt, end));

  const [countsRow] = await db
    .select({
      analysisCount: sql<string>`count(*)`,
      uniqueIpCount: sql<string>`count(distinct ${schema.analyses.ip})`,
      uniqueClientCount: sql<string>`count(distinct ${schema.analyses.clientId})`,
      inputTokens: sql<string>`coalesce(sum(coalesce(${schema.analyses.inputTokens}, 0)), 0)`,
      outputTokens: sql<string>`coalesce(sum(coalesce(${schema.analyses.outputTokens}, 0)), 0)`,
    })
    .from(schema.analyses)
    .where(inToday);

  // 費用要依每一筆各自的模型換算牌價，不能直接對 token 總和套一個牌價，
  // 所以另外撈出逐筆的模型與 token 數，在應用層加總。
  const modelRows = await db
    .select({
      model: schema.analyses.model,
      inputTokens: schema.analyses.inputTokens,
      outputTokens: schema.analyses.outputTokens,
    })
    .from(schema.analyses)
    .where(and(inToday, eq(schema.analyses.status, 'done')));

  const costEstimateUsd = modelRows.reduce(
    (sum, row) => sum + estimateCostUsd(row.model, row.inputTokens, row.outputTokens),
    0,
  );

  const [fileCountRow] = await db
    .select({ fileCount: sql<string>`count(*)` })
    .from(schema.analysisFiles)
    .innerJoin(schema.analyses, eq(schema.analysisFiles.analysisId, schema.analyses.id))
    .where(inToday);

  return {
    analysisCount: Number(countsRow?.analysisCount ?? 0),
    fileCount: Number(fileCountRow?.fileCount ?? 0),
    inputTokens: Number(countsRow?.inputTokens ?? 0),
    outputTokens: Number(countsRow?.outputTokens ?? 0),
    costEstimateUsd,
    uniqueIpCount: Number(countsRow?.uniqueIpCount ?? 0),
    uniqueClientCount: Number(countsRow?.uniqueClientCount ?? 0),
  };
}

export interface IpRankingRow {
  ip: string;
  requestCount: number;
  analysisCount: number;
  tokens: number;
  lastActivity: Date | null;
  status: IpStatus;
}

/**
 * 最近 N 小時的 IP 排行。
 *
 * 「請求數」來自 `ip_windows`（上傳＋分析＋被拒的請求都算），「分析數」與
 * 「token」來自 `analyses`；兩邊各自 group by IP 後在應用層合併，因為
 * 一個是滑動視窗表、一個是分析主檔，SQL join 兩張粒度不同的表只會把
 * 分析數重複膨脹。只出現在 `analyses`（例如 `ip_windows` 的舊桶已被
 * 排程清除）的 IP，請求數退而求其次以分析數計。
 */
export async function getRecentIpRanking(hours = 24, limit = 50): Promise<IpRankingRow[]> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const windowRows = await db
    .select({
      ip: schema.ipWindows.ip,
      requestCount: sql<string>`sum(${schema.ipWindows.uploadCount} + ${schema.ipWindows.analyzeCount} + ${schema.ipWindows.rejectedCount})`,
      lastWindow: sql<string>`max(${schema.ipWindows.bucketMinute})`,
    })
    .from(schema.ipWindows)
    .where(gte(schema.ipWindows.bucketMinute, cutoff))
    .groupBy(schema.ipWindows.ip);

  const analysisRows = await db
    .select({
      ip: schema.analyses.ip,
      analysisCount: sql<string>`count(*)`,
      tokens: sql<string>`coalesce(sum(coalesce(${schema.analyses.inputTokens}, 0) + coalesce(${schema.analyses.outputTokens}, 0)), 0)`,
      lastAnalysis: sql<string>`max(${schema.analyses.createdAt})`,
    })
    .from(schema.analyses)
    .where(gte(schema.analyses.createdAt, cutoff))
    .groupBy(schema.analyses.ip);

  const statusRows = await db.select().from(schema.ipStatus);
  const statusByIp = new Map(statusRows.map((row) => [row.ip, row.status]));

  const merged = new Map<string, IpRankingRow>();

  for (const row of windowRows) {
    merged.set(row.ip, {
      ip: row.ip,
      requestCount: Number(row.requestCount ?? 0),
      analysisCount: 0,
      tokens: 0,
      lastActivity: row.lastWindow ? new Date(row.lastWindow) : null,
      status: statusByIp.get(row.ip) ?? 'normal',
    });
  }

  for (const row of analysisRows) {
    const lastAnalysis = row.lastAnalysis ? new Date(row.lastAnalysis) : null;
    const existing = merged.get(row.ip);
    if (existing) {
      existing.analysisCount = Number(row.analysisCount ?? 0);
      existing.tokens = Number(row.tokens ?? 0);
      if (lastAnalysis && (!existing.lastActivity || lastAnalysis > existing.lastActivity)) {
        existing.lastActivity = lastAnalysis;
      }
    } else {
      merged.set(row.ip, {
        ip: row.ip,
        requestCount: Number(row.analysisCount ?? 0),
        analysisCount: Number(row.analysisCount ?? 0),
        tokens: Number(row.tokens ?? 0),
        lastActivity: lastAnalysis,
        status: statusByIp.get(row.ip) ?? 'normal',
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if (b.requestCount !== a.requestCount) return b.requestCount - a.requestCount;
      return (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0);
    })
    .slice(0, limit);
}

export interface SuspiciousEventRow {
  id: string;
  ip: string;
  status: 'suspended' | 'blocked';
  reason: string | null;
  suspendedUntil: Date | null;
  updatedAt: Date;
}

/** 可疑事件：目前處於暫停或封鎖狀態的 IP，含觸發原因與時間。 */
export async function getSuspiciousEvents(limit = 50): Promise<SuspiciousEventRow[]> {
  const rows = await db
    .select()
    .from(schema.ipStatus)
    .where(inArray(schema.ipStatus.status, ['suspended', 'blocked']))
    .orderBy(desc(schema.ipStatus.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    ip: row.ip,
    status: row.status as 'suspended' | 'blocked',
    reason: row.reason,
    suspendedUntil: row.suspendedUntil,
    updatedAt: row.updatedAt,
  }));
}

export interface SystemStatus {
  /** AI 閘道網址與金鑰是否都已在後台設定。 */
  aiConfigured: boolean;
  /** 資料庫是否連得上：這裡的查詢本身若失敗即代表連不上。 */
  dbOk: boolean;
  /** 目前排隊中（尚未開始處理）的分析數。 */
  queuedCount: number;
  /** 最近 24 小時內失敗的分析數。 */
  failedCount24h: number;
}

/** 系統狀態：AI 閘道是否已設定、資料庫是否連得上、排隊中與失敗的分析數。 */
export async function getSystemStatus(): Promise<SystemStatus> {
  let dbOk = true;
  let queuedCount = 0;
  let failedCount24h = 0;

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [queuedRow] = await db
      .select({ count: sql<string>`count(*)` })
      .from(schema.analyses)
      .where(eq(schema.analyses.status, 'queued'));
    queuedCount = Number(queuedRow?.count ?? 0);

    const [failedRow] = await db
      .select({ count: sql<string>`count(*)` })
      .from(schema.analyses)
      .where(and(eq(schema.analyses.status, 'failed'), gte(schema.analyses.createdAt, cutoff)));
    failedCount24h = Number(failedRow?.count ?? 0);
  } catch {
    dbOk = false;
  }

  const aiSettings = await getSetting('ai');
  const aiConfigured = aiSettings.gatewayUrl.trim() !== '' && aiSettings.apiKey.trim() !== '';

  return { aiConfigured, dbOk, queuedCount, failedCount24h };
}
