'use server';

import { revalidatePath } from 'next/cache';

import { blockReporterEmail, closeReport, replyToReport } from '@/lib/admin/moderation';
import { requireAdmin } from '@/auth';
import { runAction } from '@/lib/action-result';
import type { ActionResult } from '@/lib/action-result';

/**
 * 「問題回報」頁的伺服器動作。
 *
 * 寄信通知不在後台管理主控台的負責範圍內（另一個工作流負責），這裡只
 * 負責把回覆寫進資料庫並在 `email_jobs` 插入待寄工作。
 *
 * 動作一律回傳 `ActionResult` 而不是拋錯：Next.js 在正式環境會遮蔽
 * 伺服器動作拋出的訊息，畫面上只會剩下「Minified React error #...」。
 * 詳見 `@/lib/action-result`。
 */
export type { ActionResult };

async function assertAdminEmail(): Promise<string> {
  const user = await requireAdmin();
  if (!user?.email) {
    throw new Error('未登入或不在白名單內，無法執行此操作。');
  }
  return user.email;
}

function revalidateReports(): void {
  revalidatePath('/admincenter/reports');
}

/** 回覆一筆問題回報。 */
export async function replyReportAction(
  reportId: string,
  body: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const adminEmail = await assertAdminEmail();
    await replyToReport(reportId, body, adminEmail);
    revalidateReports();
    return null;
  });
}

/** 結案一筆問題回報。 */
export async function closeReportAction(reportId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const adminEmail = await assertAdminEmail();
    await closeReport(reportId, adminEmail);
    revalidateReports();
    return null;
  });
}

/** 封鎖問題回報留下的聯絡信箱。 */
export async function blockReporterAction(email: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const adminEmail = await assertAdminEmail();
    await blockReporterEmail(email, adminEmail);
    revalidateReports();
    revalidatePath('/admincenter/ips');
    return null;
  });
}
