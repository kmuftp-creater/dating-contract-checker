import 'server-only';

import { isIP } from 'node:net';

import { and, desc, eq, gt, inArray } from 'drizzle-orm';

import { db, schema } from '@/db';
import { normalizeIp } from '@/lib/guard/ip';
import { resetOffTopic } from '@/lib/guard/off-topic';

/**
 * 後台「IP 與封鎖」與「問題回報」的資料存取與操作。
 *
 * 對應設計文件第三章第 6 節（封鎖管理）與第 7 節（問題回報管理）。
 * 每一個會改變狀態的操作都呼叫 `writeAudit` 寫一筆 `admin_audit`，
 * 對應規格書「每個操作都要寫一筆 adminAudit」。
 */

/** 封鎖清單的類型：與 `schema.blocklist.type` 的列舉值一致。 */
export type BlocklistType = (typeof schema.blocklist.$inferInsert)['type'];

/**
 * 遮蔽敏感字串（AI 虛擬金鑰等），只顯示前 4 後 4 碼，供後台畫面顯示。
 * 這個檔案雖然名為「moderation」，但這是唯一一個 admin 專用、不受
 * `'use server'` 匯出限制（只能匯出 async 函式）的模組，因此把這個
 * 給多個後台頁面共用的小工具放在這裡，避免在各處重複實作。
 */
export function maskSecret(value: string): string {
  if (value === '') {
    return '（未設定）';
  }
  if (value.length <= 8) {
    return '••••••••';
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** 寫一筆管理員操作紀錄。 */
export async function writeAudit(
  adminEmail: string,
  action: string,
  target?: string | null,
): Promise<void> {
  await db.insert(schema.adminAudit).values({ adminEmail, action, target: target ?? null });
}

// ---------------------------------------------------------------------------
// IP 狀態與封鎖清單
// ---------------------------------------------------------------------------

/** 目前處於暫停中的 IP 清單。 */
export async function listSuspendedIps(): Promise<(typeof schema.ipStatus.$inferSelect)[]> {
  return db
    .select()
    .from(schema.ipStatus)
    .where(eq(schema.ipStatus.status, 'suspended'))
    .orderBy(desc(schema.ipStatus.updatedAt));
}

/** 完整封鎖清單（IP、CIDR、信箱三種混合），新到舊排序。 */
export async function listBlocklist(): Promise<(typeof schema.blocklist.$inferSelect)[]> {
  return db.select().from(schema.blocklist).orderBy(desc(schema.blocklist.createdAt));
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 驗證並正規化封鎖清單的值，格式錯誤時拋出中文錯誤訊息，不寫入資料庫。
 */
function validateAndNormalize(type: BlocklistType, rawValue: string): string {
  const value = rawValue.trim();
  if (value === '') {
    throw new Error('內容不能是空白。');
  }

  if (type === 'ip') {
    const normalized = normalizeIp(value);
    if (normalized === null) {
      throw new Error(`「${value}」不是有效的 IP 位址。`);
    }
    return normalized;
  }

  if (type === 'cidr') {
    const [addr, prefixRaw] = value.split('/');
    if (!addr || !prefixRaw) {
      throw new Error(`「${value}」不是有效的 CIDR 網段，格式應為「位址/前綴長度」，例如 203.0.113.0/24。`);
    }
    const family = isIP(addr);
    if (family === 0) {
      throw new Error(`「${value}」不是有效的 CIDR 網段（位址部分格式錯誤）。`);
    }
    const prefix = Number(prefixRaw);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new Error(`「${value}」不是有效的 CIDR 網段（前綴長度需為 0 至 ${maxPrefix} 的整數）。`);
    }
    return `${addr}/${prefix}`;
  }

  // email
  if (!EMAIL_REGEX.test(value)) {
    throw new Error(`「${value}」不是有效的信箱格式。`);
  }
  return value.toLowerCase();
}

/**
 * 新增一筆封鎖：驗證格式、寫入 `blocklist`；若是封鎖單一 IP，同步把
 * `ip_status` 設為 `blocked`，讓「IP 與封鎖」頁的暫停清單與封鎖狀態
 * 立即反映一致（`isBlocked` 只查 `blocklist`，這裡不影響擋下的即時性，
 * 只是讓後台畫面上的狀態不會顯示矛盾）。
 */
export async function addBlocklistEntry(
  type: BlocklistType,
  rawValue: string,
  reason: string,
  adminEmail: string,
): Promise<typeof schema.blocklist.$inferSelect> {
  const value = validateAndNormalize(type, rawValue);
  const trimmedReason = reason.trim();

  const duplicate = await db
    .select({ id: schema.blocklist.id })
    .from(schema.blocklist)
    .where(and(eq(schema.blocklist.type, type), eq(schema.blocklist.value, value)))
    .limit(1);
  if (duplicate.length > 0) {
    throw new Error('這個項目已經在封鎖清單中，不能重複新增。');
  }

  const [row] = await db
    .insert(schema.blocklist)
    .values({ type, value, reason: trimmedReason === '' ? null : trimmedReason })
    .returning();

  if (type === 'ip') {
    await db
      .insert(schema.ipStatus)
      .values({
        ip: value,
        status: 'blocked',
        suspendedUntil: null,
        reason: trimmedReason === '' ? '管理員手動封鎖' : trimmedReason,
        suspendCount24h: 0,
      })
      .onConflictDoUpdate({
        target: schema.ipStatus.ip,
        set: {
          status: 'blocked',
          suspendedUntil: null,
          reason: trimmedReason === '' ? '管理員手動封鎖' : trimmedReason,
          updatedAt: new Date(),
        },
      });
  }

  await writeAudit(adminEmail, `blocklist_add_${type}`, value);
  return row;
}

/** 移除一筆封鎖；若原本是封鎖 IP，連帶把 `ip_status` 復原為 `normal`。 */
export async function removeBlocklistEntry(id: string, adminEmail: string): Promise<void> {
  const [row] = await db.delete(schema.blocklist).where(eq(schema.blocklist.id, id)).returning();
  if (!row) {
    throw new Error('找不到這筆封鎖紀錄，可能已被移除。');
  }

  if (row.type === 'ip') {
    await db
      .update(schema.ipStatus)
      .set({ status: 'normal', suspendedUntil: null, reason: null, updatedAt: new Date() })
      .where(eq(schema.ipStatus.ip, row.value));
  }

  await writeAudit(adminEmail, `blocklist_remove_${row.type}`, row.value);
}

/** 對 30 分鐘暫停中的 IP 手動提前解除。 */
export async function unsuspendIp(ip: string, adminEmail: string): Promise<void> {
  const result = await db
    .update(schema.ipStatus)
    .set({ status: 'normal', suspendedUntil: null, updatedAt: new Date() })
    .where(eq(schema.ipStatus.ip, ip))
    .returning({ id: schema.ipStatus.id });

  if (result.length === 0) {
    throw new Error(`找不到 IP「${ip}」的暫停紀錄，可能已經解除或從未被暫停。`);
  }

  await writeAudit(adminEmail, 'ip_unsuspend', ip);
}

// ---------------------------------------------------------------------------
// 非交友媒合服務契約累計次數（2026-09-05 需求）
// ---------------------------------------------------------------------------

/** 目前有累計非目標文件次數的 IP 清單（不限暫停或封鎖中，只警告過的也列出來）。 */
export async function listOffTopicIps(): Promise<(typeof schema.ipStatus.$inferSelect)[]> {
  return db
    .select()
    .from(schema.ipStatus)
    .where(gt(schema.ipStatus.offTopicCount, 0))
    .orderBy(desc(schema.ipStatus.updatedAt));
}

/** 後台「歸零」操作：重設某個 IP 的非目標文件累計次數，並寫一筆稽核紀錄。 */
export async function resetOffTopicCount(ip: string, adminEmail: string): Promise<void> {
  await resetOffTopic(ip);
  await writeAudit(adminEmail, 'off_topic_reset', ip);
}

// ---------------------------------------------------------------------------
// 問題回報
// ---------------------------------------------------------------------------

export interface ReportReplyRow {
  id: string;
  body: string;
  sentEmail: boolean;
  createdAt: Date;
}

export interface ReportRow {
  id: string;
  clientId: string | null;
  ip: string;
  category: typeof schema.reports.$inferSelect.category;
  message: string;
  contactEmail: string | null;
  analysisId: string | null;
  status: typeof schema.reports.$inferSelect.status;
  createdAt: Date;
  /** 這筆回報是否附了截圖，附了才在後台顯示縮圖。 */
  hasScreenshot: boolean;
  replies: ReportReplyRow[];
}

/** 依處理狀態列出問題回報（含每筆的回覆），不帶 status 時列出全部。 */
export async function listReports(
  status?: typeof schema.reports.$inferSelect.status,
): Promise<ReportRow[]> {
  const rows = status
    ? await db
        .select()
        .from(schema.reports)
        .where(eq(schema.reports.status, status))
        .orderBy(desc(schema.reports.createdAt))
    : await db.select().from(schema.reports).orderBy(desc(schema.reports.createdAt));

  const ids = rows.map((row) => row.id);
  const repliesByReport = new Map<string, ReportReplyRow[]>();
  if (ids.length > 0) {
    const replyRows = await db
      .select()
      .from(schema.reportReplies)
      .where(inArray(schema.reportReplies.reportId, ids))
      .orderBy(schema.reportReplies.createdAt);
    for (const reply of replyRows) {
      const list = repliesByReport.get(reply.reportId) ?? [];
      list.push({
        id: reply.id,
        body: reply.body,
        sentEmail: reply.sentEmail,
        createdAt: reply.createdAt,
      });
      repliesByReport.set(reply.reportId, list);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    ip: row.ip,
    category: row.category,
    message: row.message,
    contactEmail: row.contactEmail,
    analysisId: row.analysisId,
    status: row.status,
    createdAt: row.createdAt,
    hasScreenshot: row.screenshotPath !== null,
    replies: repliesByReport.get(row.id) ?? [],
  }));
}

/**
 * 回覆問題回報：寫入 `report_replies`、把 `reports.status` 改為
 * `replied`，並在 `email_jobs` 插入一筆待寄工作（type 為
 * `report_reply`）。實際寄信由另一個工作流負責，這裡只負責把工作放進
 * 佇列（見規格書「寄信通知不在你的範圍」）。
 */
export async function replyToReport(
  reportId: string,
  body: string,
  adminEmail: string,
): Promise<void> {
  const trimmed = body.trim();
  if (trimmed === '') {
    throw new Error('回覆內容不能是空白。');
  }

  const [report] = await db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).limit(1);
  if (!report) {
    throw new Error('找不到這筆問題回報，可能已被刪除。');
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.reportReplies).values({ reportId, body: trimmed, sentEmail: false });
    await tx.update(schema.reports).set({ status: 'replied' }).where(eq(schema.reports.id, reportId));
    await tx.insert(schema.emailJobs).values({
      type: 'report_reply',
      payloadJson: {
        reportId,
        contactEmail: report.contactEmail,
        body: trimmed,
      },
      status: 'queued',
    });
  });

  await writeAudit(adminEmail, 'report_reply', reportId);
}

/** 結案：把處理狀態改為 `closed`，不影響既有回覆。 */
export async function closeReport(reportId: string, adminEmail: string): Promise<void> {
  const result = await db
    .update(schema.reports)
    .set({ status: 'closed' })
    .where(eq(schema.reports.id, reportId))
    .returning({ id: schema.reports.id });

  if (result.length === 0) {
    throw new Error('找不到這筆問題回報，可能已被刪除。');
  }

  await writeAudit(adminEmail, 'report_close', reportId);
}

/** 封鎖問題回報留下的聯絡信箱，之後該信箱不能再送出回報。 */
export async function blockReporterEmail(email: string, adminEmail: string): Promise<void> {
  await addBlocklistEntry('email', email, '於問題回報處理頁封鎖', adminEmail);
}
