'use server';

import { revalidatePath } from 'next/cache';

import {
  addBlocklistEntry,
  removeBlocklistEntry,
  resetOffTopicCount,
  unsuspendIp,
  type BlocklistType,
} from '@/lib/admin/moderation';
import { requireAdmin } from '@/auth';

/**
 * 「IP 與封鎖」頁的伺服器動作。
 *
 * 每個動作都先重新核對登入狀態，理由同 `src/app/admin/documents/actions.ts`
 * 的說明：Server Action 是可被直接呼叫的 POST 端點，不能只靠畫面上有沒有
 * 渲染按鈕來把關。
 */

async function assertAdminEmail(): Promise<string> {
  const user = await requireAdmin();
  if (!user?.email) {
    throw new Error('未登入或不在白名單內，無法執行此操作。');
  }
  return user.email;
}

function revalidateAll(): void {
  revalidatePath('/admincenter/ips');
  revalidatePath('/admincenter');
}

/** 一鍵封鎖某個 IP（儀表板與 IP 頁共用）。 */
export async function blockIpAction(ip: string, reason: string): Promise<void> {
  const adminEmail = await assertAdminEmail();
  await addBlocklistEntry('ip', ip, reason, adminEmail);
  revalidateAll();
}

/** 手動新增封鎖：IP、CIDR、信箱三種類型共用一個動作。 */
export async function addBlocklistAction(
  type: BlocklistType,
  value: string,
  reason: string,
): Promise<void> {
  const adminEmail = await assertAdminEmail();
  await addBlocklistEntry(type, value, reason, adminEmail);
  revalidateAll();
}

/** 移除一筆封鎖清單項目。 */
export async function removeBlocklistAction(id: string): Promise<void> {
  const adminEmail = await assertAdminEmail();
  await removeBlocklistEntry(id, adminEmail);
  revalidateAll();
}

/** 提前解除某個 IP 的暫停狀態。 */
export async function unsuspendAction(ip: string): Promise<void> {
  const adminEmail = await assertAdminEmail();
  await unsuspendIp(ip, adminEmail);
  revalidateAll();
}

/** 歸零某個 IP 的非目標文件累計次數。 */
export async function resetOffTopicAction(ip: string): Promise<void> {
  const adminEmail = await assertAdminEmail();
  await resetOffTopicCount(ip, adminEmail);
  revalidateAll();
}
