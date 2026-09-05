import { redirect } from 'next/navigation';

import { listBlocklist, listOffTopicIps, listSuspendedIps } from '@/lib/admin/moderation';
import { requireAdmin } from '@/auth';

import { IpsPanel, type BlocklistEntryView, type OffTopicIpView, type SuspendedIpView } from './ips-panel';

/**
 * 「IP 與封鎖」頁。
 *
 * 對應設計文件第三章第 6 節。三個區塊：目前暫停中的 IP、封鎖清單、
 * 手動新增封鎖，互動主體拆到 `ips-panel.tsx`（伺服器端只負責取資料）。
 */

export const metadata = { title: 'IP 與封鎖' };
export const dynamic = 'force-dynamic';

export default async function IpsPage() {
  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const [suspended, blocklist, offTopic] = await Promise.all([
    listSuspendedIps(),
    listBlocklist(),
    listOffTopicIps(),
  ]);

  const suspendedRows: SuspendedIpView[] = suspended.map((row) => ({
    id: row.id,
    ip: row.ip,
    reason: row.reason,
    suspendedUntil: row.suspendedUntil ? row.suspendedUntil.toISOString() : null,
    suspendCount24h: row.suspendCount24h,
    updatedAt: row.updatedAt.toISOString(),
  }));

  const blocklistRows: BlocklistEntryView[] = blocklist.map((row) => ({
    id: row.id,
    type: row.type,
    value: row.value,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }));

  const offTopicRows: OffTopicIpView[] = offTopic.map((row) => ({
    id: row.id,
    ip: row.ip,
    offTopicCount: row.offTopicCount,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">IP 與封鎖</h1>
        <p className="mt-1 text-sm text-ink-muted">
          暫停中的 IP 由防濫用規則自動觸發，可提前解除；封鎖清單支援 IP、CIDR 網段、信箱三種類型，需手動移除才會失效。
        </p>
      </div>

      <IpsPanel
        initialSuspended={suspendedRows}
        initialBlocklist={blocklistRows}
        initialOffTopic={offTopicRows}
      />
    </div>
  );
}
