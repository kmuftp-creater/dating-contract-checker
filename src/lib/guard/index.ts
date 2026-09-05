import 'server-only';

import { eq } from 'drizzle-orm';

import { db, schema } from '@/db';
import type { AbuseRulesSettings } from '@/lib/settings';
import { getSetting } from '@/lib/settings';

import { isBlocked, normalizeIp } from './ip';
import { consumeQuota, type QuotaSubject } from './quota';
import { countRecent, recordEvent } from './window';

/**
 * 防濫用與配額的對外入口。
 *
 * 對應設計文件第二章第 8 節（前台看得到的部分）與第三章第 3 節
 * （後台可調的濫用偵測規則）。這裡只提供純函式給上傳與分析 API 呼叫，
 * 不處理 HTTP、不寫路由。
 */

/** 擋下請求的原因。 */
export type GuardRejectReason =
  | 'invalid_ip'
  | 'blocked'
  | 'suspended'
  | 'token_limit'
  | 'daily_limit';

export type GuardResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: GuardRejectReason;
      /** 暫停中時，還要多少秒才能重試。 */
      retryAfterSeconds?: number;
      /** 直接顯示給使用者的繁體中文句子。 */
      message: string;
    };

const BLOCKED_MESSAGE = '此來源已被停用。';
const TOKEN_LIMIT_MESSAGE = '今日分析額度已用完，請明天再試。';
const DAILY_LIMIT_MESSAGE = '今日分析次數已用完，請於明天 00:00（台北時間）後再試。';

/** 把暫停時長換算成分鐘，並附上台北時間的可重試時刻。 */
function formatTaipeiTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** 設計文件第二章第 8 節指定的暫停訊息，時長依實際設定值產生。 */
function buildSuspendedMessage(suspendDurationSeconds: number, suspendedUntil: Date): string {
  const minutes = Math.round(suspendDurationSeconds / 60);
  return (
    `您短時間大量操作，疑似可疑行為，已暫停使用 ${minutes} 分鐘。` +
    `可於 ${formatTaipeiTime(suspendedUntil)} 後再試。`
  );
}

function retryAfterSecondsFrom(suspendedUntil: Date): number {
  return Math.max(Math.ceil((suspendedUntil.getTime() - Date.now()) / 1000), 1);
}

/**
 * 檢查此 IP 目前是否已被封鎖清單或 `ip_status` 擋下。
 * 回傳 null 代表沒有既存的封鎖或暫停狀態，可以繼續往下檢查其他規則。
 */
async function checkExistingBlockOrSuspension(ip: string): Promise<GuardResult | null> {
  if (await isBlocked(ip)) {
    return { allowed: false, reason: 'blocked', message: BLOCKED_MESSAGE };
  }

  const rows = await db
    .select()
    .from(schema.ipStatus)
    .where(eq(schema.ipStatus.ip, ip))
    .limit(1);
  const status = rows[0];
  if (!status) {
    return null;
  }

  if (status.status === 'blocked') {
    return { allowed: false, reason: 'blocked', message: BLOCKED_MESSAGE };
  }

  if (status.status === 'suspended' && status.suspendedUntil && status.suspendedUntil.getTime() > Date.now()) {
    const rules = await getSetting('abuse_rules');
    return {
      allowed: false,
      reason: 'suspended',
      retryAfterSeconds: retryAfterSecondsFrom(status.suspendedUntil),
      message: buildSuspendedMessage(rules.suspendDurationSeconds, status.suspendedUntil),
    };
  }

  return null;
}

/**
 * 觸發 R1 至 R4：寫入 `ip_status`，把狀態設為 `suspended` 並把
 * `suspendCount24h` 加一；累計次數達到 R4 閾值時改為自動封鎖並寫入
 * `blocklist`。整段包在交易裡並用 `SELECT ... FOR UPDATE` 鎖列，
 * 避免同一 IP 的多個觸發同時發生時彼此互相覆蓋計數。
 */
async function applySuspension(
  ip: string,
  rules: AbuseRulesSettings,
): Promise<{ suspendedUntil: Date | null; blocked: boolean }> {
  const now = new Date();
  const nextSuspendedUntil = new Date(now.getTime() + rules.suspendDurationSeconds * 1000);

  return db.transaction(async (tx) => {
    await tx
      .insert(schema.ipStatus)
      .values({
        ip,
        status: 'suspended',
        suspendedUntil: nextSuspendedUntil,
        suspendCount24h: 0,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: schema.ipStatus.ip });

    const [row] = await tx
      .select()
      .from(schema.ipStatus)
      .where(eq(schema.ipStatus.ip, ip))
      .for('update')
      .limit(1);

    // 24 小時內沒有活動就視為計數已經過期歸零，避免舊帳一直累加下去。
    const isStale =
      now.getTime() - row.updatedAt.getTime() > 24 * 60 * 60 * 1000;
    const baseCount = isStale ? 0 : row.suspendCount24h;
    const nextSuspendCount = baseCount + 1;
    const reachedR4 = nextSuspendCount >= rules.r4SuspendCountPer24h;

    if (reachedR4) {
      await tx
        .update(schema.ipStatus)
        .set({
          status: 'blocked',
          suspendedUntil: null,
          suspendCount24h: nextSuspendCount,
          reason: '24 小時內觸發暫停次數達上限，系統自動封鎖',
          updatedAt: now,
        })
        .where(eq(schema.ipStatus.ip, ip));

      await tx
        .insert(schema.blocklist)
        .values({
          type: 'ip',
          value: ip,
          reason: '系統自動封鎖：24 小時內觸發暫停達到上限（R4）',
        })
        .onConflictDoNothing({ target: [schema.blocklist.type, schema.blocklist.value] });

      return { suspendedUntil: null, blocked: true };
    }

    await tx
      .update(schema.ipStatus)
      .set({
        status: 'suspended',
        suspendedUntil: nextSuspendedUntil,
        suspendCount24h: nextSuspendCount,
        updatedAt: now,
      })
      .where(eq(schema.ipStatus.ip, ip));

    return { suspendedUntil: nextSuspendedUntil, blocked: false };
  });
}

/** 觸發暫停（或升級為封鎖），並記錄這次請求為被拒絕，回傳要給使用者看的結果。 */
async function triggerSuspension(ip: string, rules: AbuseRulesSettings): Promise<GuardResult> {
  const { suspendedUntil, blocked } = await applySuspension(ip, rules);
  await recordEvent(ip, 'rejected');

  if (blocked || suspendedUntil === null) {
    return { allowed: false, reason: 'blocked', message: BLOCKED_MESSAGE };
  }

  return {
    allowed: false,
    reason: 'suspended',
    retryAfterSeconds: retryAfterSecondsFrom(suspendedUntil),
    message: buildSuspendedMessage(rules.suspendDurationSeconds, suspendedUntil),
  };
}

/**
 * 檢查是否允許上傳，依序檢查：封鎖、暫停中、R1（60 秒內上傳請求數）、
 * R3（10 分鐘內失敗或被拒的請求數）。
 */
export async function checkUploadAllowed(params: {
  ip: string;
  clientId: string;
}): Promise<GuardResult> {
  const ip = normalizeIp(params.ip);
  if (ip === null) {
    return { allowed: false, reason: 'invalid_ip', message: '無法辨識您的來源位址，請稍後再試。' };
  }

  const existing = await checkExistingBlockOrSuspension(ip);
  if (existing) {
    await recordEvent(ip, 'rejected');
    return existing;
  }

  const rules = await getSetting('abuse_rules');

  const uploadCount = await countRecent(ip, 'upload', 60);
  if (uploadCount > rules.r1UploadPer60s) {
    return triggerSuspension(ip, rules);
  }

  const rejectedCount = await countRecent(ip, 'rejected', 600);
  if (rejectedCount > rules.r3RejectedPer10Min) {
    return triggerSuspension(ip, rules);
  }

  return { allowed: true };
}

/**
 * 檢查是否允許分析，依序檢查：封鎖、暫停中、R2（60 秒內分析請求數）、
 * R5（全站當日 token 上限，由呼叫端注入 `getTodayTokens` 取得目前用量，
 * 方便測試不必真的累積上百萬 token），最後檢查每日次數（同時扣抵瀏覽器
 * 識別碼與 IP 兩把尺）。
 */
export async function checkAnalyzeAllowed(
  params: { ip: string; clientId: string; fileCount: number },
  getTodayTokens: () => Promise<number>,
): Promise<GuardResult> {
  const ip = normalizeIp(params.ip);
  if (ip === null) {
    return { allowed: false, reason: 'invalid_ip', message: '無法辨識您的來源位址，請稍後再試。' };
  }

  const existing = await checkExistingBlockOrSuspension(ip);
  if (existing) {
    await recordEvent(ip, 'rejected');
    return existing;
  }

  const rules = await getSetting('abuse_rules');

  const analyzeCount = await countRecent(ip, 'analyze', 60);
  if (analyzeCount > rules.r2AnalyzePer60s) {
    return triggerSuspension(ip, rules);
  }

  const todayTokens = await getTodayTokens();
  if (todayTokens >= rules.r5DailyTokenLimit) {
    await recordEvent(ip, 'rejected');
    return { allowed: false, reason: 'token_limit', message: TOKEN_LIMIT_MESSAGE };
  }

  const subjects: QuotaSubject[] = [
    { type: 'client', value: params.clientId },
    { type: 'ip', value: ip },
  ];
  const quotaResult = await consumeQuota(subjects, params.fileCount);
  if (!quotaResult.allowed) {
    await recordEvent(ip, 'rejected');
    return { allowed: false, reason: 'daily_limit', message: DAILY_LIMIT_MESSAGE };
  }

  return { allowed: true };
}
