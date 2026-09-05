import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { db, schema } from '@/db';
import { taipeiDateString } from '@/lib/guard/quota';
import { saveArchive, saveContractImages } from '@/lib/storage';
import type {
  AnalysisMode,
  AnalysisResult,
  ArchiveResult,
  ExtractedImage,
  ExtractMethod,
  FileCategory,
  TokenUsage,
} from '@/lib/types';

/**
 * 分析的資料存取層。
 *
 * `analyses` 表本身就是背景工作程序的佇列（見設計文件第五章），
 * `claimNext` 用 `SELECT ... FOR UPDATE SKIP LOCKED` 取件，避免另外架
 * Redis 或訊息佇列。
 */

export type AnalysisRow = typeof schema.analyses.$inferSelect;
export type AnalysisFileRow = typeof schema.analysisFiles.$inferSelect;

export interface AnalysisWithFiles {
  row: AnalysisRow;
  files: AnalysisFileRow[];
}

export interface AnalysisListRow {
  row: AnalysisRow;
  fileNames: string[];
}

/**
 * 依 `analysisFiles.mime`（存的是原始檔案的 MIME，不是封存後的類型）
 * 回推 `FileCategory`，供組回 API 回應時使用。資料表沒有獨立的 category
 * 欄位，這裡用 MIME 當單一事實來源，避免另外多存一個容易與 MIME 兜不
 * 起來的欄位。
 */
export function categoryFromMime(mime: string): FileCategory {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'word';
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'excel';
  return 'text';
}

/** 建立一筆分析所需的單一檔案內容，已完成抽取，尚未落地封存。 */
export interface AnalysisFilePlan {
  originalName: string;
  /** 原始檔案的 MIME 類型；貼上的文字固定為 text/plain。 */
  mime: string;
  /** 原始檔案大小（位元組）；貼上的文字則為其 UTF-8 位元組數。 */
  size: number;
  extractMethod: ExtractMethod | null;
  pageCount: number | null;
  /** 抽出的純文字，無文字內容時為空字串。 */
  text: string;
  /** 走影像辨識路徑時的圖片，其餘為空陣列。 */
  images: ExtractedImage[];
  /** 封存用的轉檔結果；貼上的文字沒有原始檔可封存，為 null。 */
  archive: ArchiveResult | null;
}

export interface CreateAnalysisParams {
  clientId: string;
  ip: string;
  mode: AnalysisMode;
  files: AnalysisFilePlan[];
  checklistVersionId: string;
  regulationVersionId: string;
  /** 兩碼國別代碼，來自 Cloudflare。取不到時為 null。 */
  country?: string | null;
}

/**
 * 建立一筆分析：寫入 `analyses` 一列（狀態固定為 `queued`）與對應的
 * `analysisFiles`。呼叫端負責決定「這一批檔案算一筆分析」——`merged`
 * 模式呼叫一次帶全部檔案，`separate` 模式對每個檔案各呼叫一次。
 *
 * id 由這裡先產生（不是交給資料庫的 `defaultRandom()`），因為封存檔案
 * 要用同一個 id 分子目錄，需要在寫資料庫之前就知道 id。
 */
export async function createAnalysis(params: CreateAnalysisParams): Promise<string> {
  const analysisId = randomUUID();

  const fileRows: (typeof schema.analysisFiles.$inferInsert)[] = [];
  for (const file of params.files) {
    let storagePath: string | null = null;
    if (file.archive) {
      storagePath = await saveArchive(file.archive, analysisId);
      if (file.images.length > 0) {
        await saveContractImages(file.images, storagePath);
      }
    }
    fileRows.push({
      analysisId,
      originalName: file.originalName,
      mime: file.mime,
      size: file.size,
      storagePath,
      extractMethod: file.extractMethod,
      extractedText: file.text,
      pageCount: file.pageCount,
    });
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.analyses).values({
      id: analysisId,
      clientId: params.clientId,
      ip: params.ip,
      country: params.country ?? null,
      mode: params.mode,
      status: 'queued',
      checklistVersionId: params.checklistVersionId,
      regulationVersionId: params.regulationVersionId,
    });
    if (fileRows.length > 0) {
      await tx.insert(schema.analysisFiles).values(fileRows);
    }
  });

  return analysisId;
}

/**
 * 取一筆 `queued` 的分析改為 `running`，供背景工作程序處理。
 * `SKIP LOCKED` 讓多個工作程序同時輪詢時不會搶同一筆，也不會被彼此
 * 卡住等鎖。沒有可取的工作時回傳 null。
 */
export async function claimNext(): Promise<AnalysisRow | null> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: schema.analyses.id })
      .from(schema.analyses)
      .where(eq(schema.analyses.status, 'queued'))
      .orderBy(schema.analyses.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });

    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }

    const [updated] = await tx
      .update(schema.analyses)
      .set({ status: 'running' })
      .where(eq(schema.analyses.id, candidate.id))
      .returning();

    return updated ?? null;
  });
}

/** 標記分析完成，寫入結果與用量。 */
export async function markDone(
  id: string,
  result: AnalysisResult,
  usage: TokenUsage,
  model: string,
): Promise<void> {
  await db
    .update(schema.analyses)
    .set({
      status: 'done',
      resultJson: result,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      model,
      finishedAt: new Date(),
    })
    .where(eq(schema.analyses.id, id));
}

/**
 * 標記分析失敗。
 *
 * 失敗訊息寫進獨立的 `error_message` 欄位，`result_json` 維持 null。
 * 兩者分開的理由：混在一起會讓「有結果但結果為空」與「根本沒有結果」
 * 分不出來，後台也無法依失敗原因篩選。
 */
export async function markFailed(id: string, message: string): Promise<void> {
  await db
    .update(schema.analyses)
    .set({
      status: 'failed',
      errorMessage: message,
      finishedAt: new Date(),
    })
    .where(eq(schema.analyses.id, id));
}

/** 只回傳屬於該瀏覽器識別碼的分析；查別人的一律回 null，不洩漏是否存在。 */
export async function getForClient(
  id: string,
  clientId: string,
): Promise<AnalysisWithFiles | null> {
  const rows = await db
    .select()
    .from(schema.analyses)
    .where(and(eq(schema.analyses.id, id), eq(schema.analyses.clientId, clientId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const files = await listFiles(id);
  return { row, files };
}

/** 取某筆分析的所有檔案，依建檔順序（表沒有排序欄位，用主鍵穩定排序）。 */
export async function listFiles(analysisId: string): Promise<AnalysisFileRow[]> {
  return db
    .select()
    .from(schema.analysisFiles)
    .where(eq(schema.analysisFiles.analysisId, analysisId))
    .orderBy(schema.analysisFiles.id);
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, id] = decoded.split('|');
    if (!createdAt || !id) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * 列出某瀏覽器識別碼的歷史紀錄，新到舊排序，游標式分頁。
 * `cursor` 是上一頁最後一筆的 `(createdAt, id)` 編碼，null 代表第一頁。
 */
export async function listForClient(
  clientId: string,
  cursor: string | null,
  limit: number,
): Promise<{ items: AnalysisListRow[]; nextCursor: string | null }> {
  const conditions = [eq(schema.analyses.clientId, clientId)];

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      conditions.push(
        sql`(${schema.analyses.createdAt}, ${schema.analyses.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`,
      );
    }
  }

  const rows = await db
    .select()
    .from(schema.analyses)
    .where(and(...conditions))
    .orderBy(desc(schema.analyses.createdAt), desc(schema.analyses.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const fileNamesByAnalysis = new Map<string, string[]>();
  if (page.length > 0) {
    const ids = page.map((row) => row.id);
    const fileRows = await db
      .select({
        analysisId: schema.analysisFiles.analysisId,
        originalName: schema.analysisFiles.originalName,
      })
      .from(schema.analysisFiles)
      .where(inArray(schema.analysisFiles.analysisId, ids));
    for (const fileRow of fileRows) {
      const list = fileNamesByAnalysis.get(fileRow.analysisId) ?? [];
      list.push(fileRow.originalName);
      fileNamesByAnalysis.set(fileRow.analysisId, list);
    }
  }

  const items = page.map((row) => ({
    row,
    fileNames: fileNamesByAnalysis.get(row.id) ?? [],
  }));

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return { items, nextCursor };
}

/**
 * 今日（台北時間）所有分析的輸入加輸出 token 總和，供 R5 熔斷判斷
 * （`checkAnalyzeAllowed` 的 `getTodayTokens` 參數）。只有 `done` 的分析
 * 才會有 token 數，`queued`／`running`／`failed` 一律是 null，
 * `coalesce` 後不影響加總。
 */
export async function getTodayTokenTotal(): Promise<number> {
  const day = taipeiDateString();
  const start = new Date(`${day}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      total: sql<string>`coalesce(sum(coalesce(${schema.analyses.inputTokens}, 0) + coalesce(${schema.analyses.outputTokens}, 0)), 0)`,
    })
    .from(schema.analyses)
    .where(and(gte(schema.analyses.createdAt, start), lt(schema.analyses.createdAt, end)));

  return Number(rows[0]?.total ?? 0);
}
