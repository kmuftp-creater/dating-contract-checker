import 'server-only';

import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';

import { db, schema } from '@/db';
import { normalizeIp } from '@/lib/guard/ip';
import type { AnalysisMode, AnalysisResult, AnalysisStatus } from '@/lib/types';

import { estimateCostUsd } from './stats';

/**
 * 後台「使用紀錄」頁的查詢與 CSV 匯出。
 *
 * 對應設計文件第三章第 4 節。列出、篩選、分頁都是同一組條件，CSV 匯出
 * 沿用同一個查詢函式（不分頁、撈全部符合條件的資料）以確保「畫面上看到
 * 的資料」與「匯出的資料」一致。
 */

export interface AnalysisRecordFilter {
  ip?: string;
  /** 台北時間當天 00:00 起（含）。格式 YYYY-MM-DD。 */
  dateFrom?: string;
  /** 台北時間當天 24:00 前（含當天）。格式 YYYY-MM-DD。 */
  dateTo?: string;
  status?: AnalysisStatus;
}

export interface AnalysisRecordRow {
  id: string;
  createdAt: Date;
  finishedAt: Date | null;
  ip: string;
  /** 兩碼國別代碼，來自 Cloudflare。舊資料或未經 Cloudflare 時為 null。 */
  country: string | null;
  clientId: string;
  mode: AnalysisMode;
  status: AnalysisStatus;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costEstimateUsd: number;
  summary: AnalysisResult['summary'] | null;
  errorMessage: string | null;
  fileNames: string[];
}

function buildConditions(filter: AnalysisRecordFilter): SQL[] {
  const conditions: SQL[] = [];

  if (filter.ip && filter.ip.trim() !== '') {
    const normalized = normalizeIp(filter.ip.trim()) ?? filter.ip.trim();
    conditions.push(eq(schema.analyses.ip, normalized));
  }
  if (filter.status) {
    conditions.push(eq(schema.analyses.status, filter.status));
  }
  if (filter.dateFrom) {
    conditions.push(gte(schema.analyses.createdAt, new Date(`${filter.dateFrom}T00:00:00+08:00`)));
  }
  if (filter.dateTo) {
    const end = new Date(`${filter.dateTo}T00:00:00+08:00`);
    end.setDate(end.getDate() + 1);
    conditions.push(lt(schema.analyses.createdAt, end));
  }

  return conditions;
}

async function attachFileNames(
  ids: string[],
): Promise<Map<string, string[]>> {
  const fileNamesByAnalysis = new Map<string, string[]>();
  if (ids.length === 0) {
    return fileNamesByAnalysis;
  }
  const fileRows = await db
    .select({
      analysisId: schema.analysisFiles.analysisId,
      originalName: schema.analysisFiles.originalName,
    })
    .from(schema.analysisFiles)
    .where(inArray(schema.analysisFiles.analysisId, ids));
  for (const file of fileRows) {
    const list = fileNamesByAnalysis.get(file.analysisId) ?? [];
    list.push(file.originalName);
    fileNamesByAnalysis.set(file.analysisId, list);
  }
  return fileNamesByAnalysis;
}

/** 依篩選條件列出使用紀錄（分頁），page 從 1 起算。 */
export async function listAnalyses(
  filter: AnalysisRecordFilter,
  page: number,
  pageSize: number,
): Promise<{ rows: AnalysisRecordRow[]; total: number }> {
  const conditions = buildConditions(filter);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ total: sql<string>`count(*)` })
    .from(schema.analyses)
    .where(where);

  const rows = await db
    .select()
    .from(schema.analyses)
    .where(where)
    .orderBy(desc(schema.analyses.createdAt))
    .limit(pageSize)
    .offset(Math.max(page - 1, 0) * pageSize);

  const fileNamesByAnalysis = await attachFileNames(rows.map((row) => row.id));

  const mapped: AnalysisRecordRow[] = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    ip: row.ip,
    country: row.country ?? null,
    clientId: row.clientId,
    mode: row.mode,
    status: row.status,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costEstimateUsd: estimateCostUsd(row.model, row.inputTokens, row.outputTokens),
    summary: row.resultJson?.summary ?? null,
    errorMessage: row.errorMessage,
    fileNames: fileNamesByAnalysis.get(row.id) ?? [],
  }));

  return { rows: mapped, total: Number(totalRow?.total ?? 0) };
}

export interface AnalysisDetailForAdmin {
  row: typeof schema.analyses.$inferSelect;
  files: (typeof schema.analysisFiles.$inferSelect)[];
}

/** 取單筆分析的完整內容供後台檢視，不限制擁有者（管理員可以看任何一筆）。 */
export async function getAnalysisForAdmin(id: string): Promise<AnalysisDetailForAdmin | null> {
  const rows = await db.select().from(schema.analyses).where(eq(schema.analyses.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const files = await db
    .select()
    .from(schema.analysisFiles)
    .where(eq(schema.analysisFiles.analysisId, id))
    .orderBy(schema.analysisFiles.id);
  return { row, files };
}

const MODE_LABEL: Record<AnalysisMode, string> = {
  merged: '合併為一份合約',
  separate: '各檔獨立分析',
};

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: '排隊中',
  running: '處理中',
  done: '完成',
  failed: '失敗',
};

const CSV_HEADERS = [
  '時間',
  'IP',
  '瀏覽器識別碼',
  '模式',
  '檔案數',
  '檔名',
  '模型',
  '輸入token',
  '輸出token',
  '估算費用(美元)',
  '符合',
  '不符合',
  '建議修正',
  '不適用',
  '狀態',
  '失敗原因',
];

/** 逗號、雙引號、換行任一存在時才加雙引號並跳脫內部雙引號，符合 RFC 4180。 */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDateTimeTaipei(date: Date): string {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'short',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * 匯出符合篩選條件的使用紀錄為 CSV 內容（不含 BOM，BOM 由呼叫端的路由
 * 處理常式加上，因為那是 HTTP 回應層的關注點，不屬於這個資料函式）。
 */
export async function buildAnalysesCsv(filter: AnalysisRecordFilter): Promise<string> {
  // 匯出不分頁：後台使用情境下資料量可控，撈全部符合條件的資料。
  const { rows } = await listAnalyses(filter, 1, 1_000_000);

  const lines = [CSV_HEADERS.map(csvEscape).join(',')];
  for (const row of rows) {
    const fields = [
      formatDateTimeTaipei(row.createdAt),
      row.ip,
      row.clientId,
      MODE_LABEL[row.mode],
      String(row.fileNames.length),
      row.fileNames.join('；'),
      row.model ?? '',
      row.inputTokens === null ? '' : String(row.inputTokens),
      row.outputTokens === null ? '' : String(row.outputTokens),
      row.costEstimateUsd.toFixed(6),
      row.summary ? String(row.summary.pass) : '',
      row.summary ? String(row.summary.fail) : '',
      row.summary ? String(row.summary.fix) : '',
      row.summary ? String(row.summary.na) : '',
      STATUS_LABEL[row.status],
      row.errorMessage ?? '',
    ];
    lines.push(fields.map(csvEscape).join(','));
  }

  return lines.join('\r\n');
}
