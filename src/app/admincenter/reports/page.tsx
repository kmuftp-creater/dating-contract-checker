import { redirect } from 'next/navigation';

import { listReports } from '@/lib/admin/moderation';
import { requireAdmin } from '@/auth';
import type { ReportStatus } from '@/lib/types';

import { ReportsPanel, type ReportView } from './reports-panel';
import { ReportsStatusTabs } from './status-tabs';

/**
 * 「問題回報」頁。
 *
 * 對應設計文件第三章第 7 節。三種狀態篩選（未處理、已回覆、已結案）用
 * 網址查詢字串 `status` 保存，不帶 `status` 時列出全部；互動主體（回覆、
 * 結案、封鎖信箱）拆到 `reports-panel.tsx`。
 */

export const metadata = { title: '問題回報' };
export const dynamic = 'force-dynamic';

function isReportStatus(value: string | undefined): value is ReportStatus {
  return value === 'open' || value === 'replied' || value === 'closed';
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const { status: statusRaw } = await searchParams;
  const status = isReportStatus(statusRaw) ? statusRaw : undefined;

  const rows = await listReports(status);

  const views: ReportView[] = rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    ip: row.ip,
    category: row.category,
    message: row.message,
    contactEmail: row.contactEmail,
    analysisId: row.analysisId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    hasScreenshot: row.hasScreenshot,
    replies: row.replies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      sentEmail: reply.sentEmail,
      createdAt: reply.createdAt.toISOString(),
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">問題回報</h1>
        <p className="mt-1 text-sm text-ink-muted">共 {views.length} 筆，可依處理狀態篩選、回覆、結案或封鎖來源信箱。</p>
      </div>

      <ReportsStatusTabs current={status} />

      <ReportsPanel reports={views} />
    </div>
  );
}
