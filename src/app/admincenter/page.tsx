import {
  AlertTriangle,
  Ban,
  Database,
  Loader2,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { redirect } from 'next/navigation';

import {
  getRecentIpRanking,
  getSuspiciousEvents,
  getSystemStatus,
  getTodayOverview,
} from '@/lib/admin/stats';
import { requireAdmin } from '@/auth';

import { DashboardIpRanking, type DashboardIpRankingRow } from './dashboard-ip-ranking';

export const metadata = { title: '總覽' };

/** 儀表板每次都取即時資料，不快取，管理員才看得到最新狀況。 */
export const dynamic = 'force-dynamic';

function formatDateTime(date: Date | null): string {
  if (!date) return '－';
  return date.toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function formatUsd(value: number): string {
  return `US$ ${value.toFixed(4)}`;
}

export default async function AdminHomePage() {
  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const [overview, ranking, suspicious, systemStatus] = await Promise.all([
    getTodayOverview(),
    getRecentIpRanking(24, 50),
    getSuspiciousEvents(50),
    getSystemStatus(),
  ]);

  const rankingRows: DashboardIpRankingRow[] = ranking.map((row) => ({
    ip: row.ip,
    requestCount: row.requestCount,
    analysisCount: row.analysisCount,
    tokens: row.tokens,
    lastActivity: row.lastActivity ? row.lastActivity.toISOString() : null,
    status: row.status,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">總覽</h1>
        <p className="mt-1 text-sm text-ink-muted">今日概況、最近 24 小時的來源活動與系統狀態。</p>
      </div>

      {/* 今日概況 */}
      <div>
        <p className="mb-3 text-sm font-medium text-ink">今日概況</p>
        {overview.analysisCount === 0 ? (
          <div className="card p-6 text-sm text-ink-muted">今日尚無分析資料。</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="分析次數" value={String(overview.analysisCount)} />
            <StatTile label="上傳檔案數" value={String(overview.fileCount)} />
            <StatTile
              label="消耗 token"
              value={(overview.inputTokens + overview.outputTokens).toLocaleString('zh-Hant-TW')}
            />
            <StatTile label="估算費用" value={formatUsd(overview.costEstimateUsd)} />
            <StatTile label="獨立 IP 數" value={String(overview.uniqueIpCount)} />
            <StatTile label="獨立瀏覽器數" value={String(overview.uniqueClientCount)} />
          </div>
        )}
      </div>

      {/* 最近 24 小時 IP 排行 */}
      <DashboardIpRanking rows={rankingRows} />

      {/* 可疑事件 */}
      <div className="card p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
          <ShieldAlert className="size-4 text-warn" aria-hidden />
          可疑事件
        </p>
        {suspicious.length === 0 ? (
          <p className="text-sm text-ink-muted">目前沒有處於暫停或封鎖狀態的 IP。</p>
        ) : (
          <ul className="space-y-2">
            {suspicious.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-control) border border-hairline p-3 text-sm"
              >
                {event.status === 'blocked' ? (
                  <Ban className="size-4 shrink-0 text-danger" aria-hidden />
                ) : (
                  <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
                )}
                <span className="font-medium text-ink">{event.ip}</span>
                <span className={event.status === 'blocked' ? 'text-danger' : 'text-warn'}>
                  {event.status === 'blocked' ? '已封鎖' : '暫停中'}
                </span>
                <span className="text-ink-muted">{event.reason ?? '無記錄原因'}</span>
                <span className="ml-auto text-xs text-ink-muted">
                  {formatDateTime(event.updatedAt)}
                  {event.suspendedUntil && `　可於 ${formatDateTime(event.suspendedUntil)} 後恢復`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 系統狀態 */}
      <div className="card p-4">
        <p className="mb-3 text-sm font-medium text-ink">系統狀態</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SystemStatusTile
            icon={<Sparkles className="size-4" aria-hidden />}
            label="AI 閘道"
            ok={systemStatus.aiConfigured}
            okText="已設定"
            badText="尚未設定"
          />
          <SystemStatusTile
            icon={<Database className="size-4" aria-hidden />}
            label="資料庫"
            ok={systemStatus.dbOk}
            okText="連線正常"
            badText="連不上"
          />
          <SystemStatusTile
            icon={<Loader2 className="size-4" aria-hidden />}
            label="排隊中的分析"
            ok
            okText={`${systemStatus.queuedCount} 筆`}
            badText=""
            neutral
          />
          <SystemStatusTile
            icon={<XCircle className="size-4" aria-hidden />}
            label="最近 24 小時失敗"
            ok={systemStatus.failedCount24h === 0}
            okText={`${systemStatus.failedCount24h} 筆`}
            badText={`${systemStatus.failedCount24h} 筆`}
          />
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4 text-center">
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink-muted">{label}</p>
    </div>
  );
}

function SystemStatusTile({
  icon,
  label,
  ok,
  okText,
  badText,
  neutral = false,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
  neutral?: boolean;
}) {
  const colorClassName = neutral ? 'text-ink' : ok ? 'text-ok' : 'text-danger';
  return (
    <div className="flex items-center gap-3 rounded-(--radius-control) border border-hairline p-3">
      <span className={colorClassName}>{icon}</span>
      <div>
        <p className="text-xs text-ink-muted">{label}</p>
        <p className={`text-sm font-medium ${colorClassName}`}>{ok ? okText : badText}</p>
      </div>
    </div>
  );
}
