import 'server-only';

import { eq } from 'drizzle-orm';

import { db, schema } from '@/db';
import type { AbuseRulesSettings } from '@/lib/settings';
import { getSetting } from '@/lib/settings';

/**
 * 「上傳非交友媒合服務契約」的階梯式處置（2026-09-05 需求）。
 *
 * 判定本身在 `src/lib/ai/relevance.ts`，這裡只負責累計次數、依閾值決定
 * 處置、並沿用既有的暫停與封鎖機制：
 *
 * - 暫停：直接把 `ip_status.status` 寫成 `suspended`、`suspended_until`
 *   設為現在加上既有的 `suspendDurationSeconds`。之後任何請求都會被
 *   `src/lib/guard/index.ts` 既有的 `checkExistingBlockOrSuspension`
 *   （`checkUploadAllowed`／`checkAnalyzeAllowed` 共用）擋下——那段邏輯
 *   只看 `ip_status` 的 `status`／`suspended_until`，不管是哪個原因寫入
 *   的，因此完全不需要修改 `guard/index.ts`（本次任務不可異動的檔案）。
 * - 封鎖：寫入 `blocklist`（type 為 `ip`），沿用 `src/lib/guard/ip.ts` 的
 *   `isBlocked` 比對邏輯，同步把 `ip_status.status` 設為 `blocked`。
 *
 * `offTopicCount` 與既有 R1 至 R4 使用的 `suspendCount24h` 是各自獨立的
 * 欄位：這裡的累計次數不會因為 24 小時經過而自動歸零（不同於
 * `suspendCount24h` 的 24 小時視窗），只能由後台的「歸零」操作重設
 * （見 `resetOffTopic`），理由是規格書要求「管理員要看得到累計次數，
 * 而且能手動歸零」，隱含這個累計是長期性的，不是短期速率視窗。
 */

export type OffTopicAction = 'warn' | 'suspend' | 'block';

export interface OffTopicOutcome {
  action: OffTopicAction;
  /** 累加後的次數。 */
  count: number;
  /** action 為 suspend 時的解除時間，其餘為 null。 */
  suspendedUntil: Date | null;
}

/** 把時間戳換算成台北時區的可讀時刻，訊息用。 */
function formatTaipeiTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * 累加某個 IP 上傳非目標文件的次數，依 `abuse_rules` 設定的閾值決定要
 * 只警告、暫停、還是封鎖。整段包在交易裡並用 `SELECT ... FOR UPDATE`
 * 鎖列，理由與 `guard/index.ts` 的 `applySuspension` 相同：避免同一 IP
 * 短時間內多個請求同時觸發時彼此互相覆蓋計數。
 *
 * `abuse_rules.offTopicRuleEnabled` 為 false 時（後台總開關關閉），
 * 呼叫端本來就不應該呼叫這個函式；這裡仍保留一份保守處理，即使被呼叫
 * 也只會累加次數並回傳 `warn`，不會觸發暫停或封鎖，避免總開關的狀態
 * 因為呼叫端邏輯疏漏而失效。
 */
export async function recordOffTopic(ip: string): Promise<OffTopicOutcome> {
  const rules = await getSetting('abuse_rules');
  const now = new Date();

  return db.transaction(async (tx) => {
    await tx
      .insert(schema.ipStatus)
      .values({ ip, updatedAt: now })
      .onConflictDoNothing({ target: schema.ipStatus.ip });

    const [row] = await tx
      .select()
      .from(schema.ipStatus)
      .where(eq(schema.ipStatus.ip, ip))
      .for('update')
      .limit(1);

    const nextCount = row.offTopicCount + 1;

    if (!rules.offTopicRuleEnabled) {
      await tx
        .update(schema.ipStatus)
        .set({ offTopicCount: nextCount, updatedAt: now })
        .where(eq(schema.ipStatus.ip, ip));
      return { action: 'warn' as const, count: nextCount, suspendedUntil: null };
    }

    if (nextCount >= rules.offTopicBlockThreshold) {
      await tx
        .update(schema.ipStatus)
        .set({
          offTopicCount: nextCount,
          status: 'blocked',
          suspendedUntil: null,
          reason: '重複上傳非交友媒合服務契約，系統自動封鎖',
          updatedAt: now,
        })
        .where(eq(schema.ipStatus.ip, ip));

      await tx
        .insert(schema.blocklist)
        .values({
          type: 'ip',
          value: ip,
          reason: '系統自動封鎖：重複上傳非交友媒合服務契約',
        })
        .onConflictDoNothing({ target: [schema.blocklist.type, schema.blocklist.value] });

      return { action: 'block' as const, count: nextCount, suspendedUntil: null };
    }

    if (nextCount >= rules.offTopicSuspendThreshold) {
      const suspendedUntil = new Date(now.getTime() + rules.suspendDurationSeconds * 1000);
      await tx
        .update(schema.ipStatus)
        .set({
          offTopicCount: nextCount,
          status: 'suspended',
          suspendedUntil,
          reason: '上傳非交友媒合服務契約，暫停使用',
          updatedAt: now,
        })
        .where(eq(schema.ipStatus.ip, ip));

      return { action: 'suspend' as const, count: nextCount, suspendedUntil };
    }

    await tx
      .update(schema.ipStatus)
      .set({ offTopicCount: nextCount, updatedAt: now })
      .where(eq(schema.ipStatus.ip, ip));

    return { action: 'warn' as const, count: nextCount, suspendedUntil: null };
  });
}

/**
 * 後台「歸零」操作：把某個 IP 的非目標文件累計次數重設為 0。
 *
 * 只歸零次數，不連帶解除既有的暫停或封鎖狀態——那是各自獨立的操作
 * （後台既有的「提前解除」「移除封鎖」，見 `src/lib/admin/moderation.ts`），
 * 避免一次操作同時做兩件語意不同的事、卻只有一個按鈕能反悔。
 */
export async function resetOffTopic(ip: string): Promise<void> {
  await db
    .update(schema.ipStatus)
    .set({ offTopicCount: 0, updatedAt: new Date() })
    .where(eq(schema.ipStatus.ip, ip));
}

/**
 * 組出要顯示給使用者的中文訊息：本站只檢查什麼、系統看起來收到的是什麼、
 * 目前第幾次、繼續上傳會怎樣、以及可以怎麼申訴（規格書 C 段）。
 */
export function buildOffTopicMessage(
  documentType: string,
  outcome: OffTopicOutcome,
  rules: AbuseRulesSettings,
): string {
  const typeLabel = documentType.trim() !== '' ? documentType.trim() : '看起來不是交友媒合服務契約的文件';
  const base =
    `本站只檢查交友媒合服務契約，系統判斷您上傳的內容為「${typeLabel}」，` +
    `這是您第 ${outcome.count} 次上傳非目標文件。`;
  const appeal = '如認為這是誤判，請使用本站「問題回報」功能說明情況，我們會盡快處理。';

  if (outcome.action === 'block') {
    return `${base}已依規則自動封鎖您的來源。${appeal}`;
  }

  if (outcome.action === 'suspend' && outcome.suspendedUntil) {
    const minutes = Math.round(rules.suspendDurationSeconds / 60);
    return (
      `${base}已暫停使用 ${minutes} 分鐘，可於 ${formatTaipeiTime(outcome.suspendedUntil)} 後再試；` +
      `再次上傳非目標文件將被系統封鎖。${appeal}`
    );
  }

  return `${base}請確認上傳內容是否正確；再次上傳非目標文件將暫停使用。${appeal}`;
}
