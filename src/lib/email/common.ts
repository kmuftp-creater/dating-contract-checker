import 'server-only';

import { schema } from '@/db';
import { getSetting } from '@/lib/settings';

/**
 * 寄信各模組共用的型別與小工具。
 *
 * 核心的寄信路徑與擴充點掛上來的寄信路徑都要用到工作列的型別與寄件人
 * 標頭。擴充的部分整個模組可被替換（見 `./hooks.ts`），所以共用的東西
 * 放這裡，不能跟著它一起消失。
 */

export type EmailJobRow = typeof schema.emailJobs.$inferSelect;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 依 SMTP 設定組出寄件人標頭；未設定使用者時退回 no-reply@localhost。 */
export async function buildFromHeader(): Promise<string> {
  const smtp = await getSetting('smtp');
  const address = smtp.user.trim() || 'no-reply@localhost';
  return `"${smtp.fromName}" <${address}>`;
}
