'use client';

import { Ban } from 'lucide-react';

import { IpAddress } from '@/components/ip-address';
import { useState, useTransition } from 'react';

import type { IpStatus } from '@/lib/types';

import { blockIpAction } from './actions/moderation';

/**
 * 儀表板「最近 24 小時 IP 排行」表格，含一鍵封鎖按鈕。
 *
 * 獨立成用戶端元件的理由：封鎖是有副作用的操作，需要按鈕忙碌狀態與
 * 錯誤訊息這些用戶端狀態，`page.tsx` 只負責伺服器端取資料。
 */

const STATUS_LABEL: Record<IpStatus, string> = {
  normal: '正常',
  suspended: '暫停中',
  blocked: '已封鎖',
};

const STATUS_COLOR: Record<IpStatus, string> = {
  normal: 'text-ok',
  suspended: 'text-warn',
  blocked: 'text-danger',
};

function formatDateTime(date: string | null): string {
  if (!date) return '－';
  return new Date(date).toLocaleString('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
}

export interface DashboardIpRankingRow {
  ip: string;
  requestCount: number;
  analysisCount: number;
  tokens: number;
  lastActivity: string | null;
  status: IpStatus;
}

export function DashboardIpRanking({ rows: initialRows }: { rows: DashboardIpRankingRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [pendingIp, setPendingIp] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleBlock(ip: string): void {
    if (!window.confirm(`確定要封鎖 IP「${ip}」嗎？這會立即擋下該來源的所有前台請求。`)) {
      return;
    }
    setErrorMessage(null);
    setPendingIp(ip);
    startTransition(async () => {
      try {
        await blockIpAction(ip, '於儀表板一鍵封鎖');
        setRows((prev) =>
          prev.map((row) => (row.ip === ip ? { ...row, status: 'blocked' as const } : row)),
        );
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '封鎖失敗。');
      } finally {
        setPendingIp(null);
      }
    });
  }

  return (
    <div className="card p-4">
      <p className="mb-3 text-sm font-medium text-ink">最近 24 小時 IP 排行</p>
      {errorMessage && <p className="mb-3 text-sm text-danger">{errorMessage}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">最近 24 小時尚無資料。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-hairline text-ink-muted">
                <th className="px-3 py-2 font-semibold">IP</th>
                <th className="px-3 py-2 font-semibold">請求數</th>
                <th className="px-3 py-2 font-semibold">分析數</th>
                <th className="px-3 py-2 font-semibold">token</th>
                <th className="px-3 py-2 font-semibold">最後活動</th>
                <th className="px-3 py-2 font-semibold">狀態</th>
                <th className="px-3 py-2 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ip} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2 text-ink">
                    <IpAddress value={row.ip} />
                  </td>
                  <td className="px-3 py-2 text-ink">{row.requestCount}</td>
                  <td className="px-3 py-2 text-ink">{row.analysisCount}</td>
                  <td className="px-3 py-2 text-ink">{row.tokens.toLocaleString('zh-Hant-TW')}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                    {formatDateTime(row.lastActivity)}
                  </td>
                  <td className={`px-3 py-2 font-medium ${STATUS_COLOR[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleBlock(row.ip)}
                      disabled={row.status === 'blocked' || (isPending && pendingIp === row.ip)}
                      className="inline-flex items-center gap-1.5 rounded-(--radius-control) border border-danger/50 px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Ban className="size-3.5" aria-hidden />
                      {isPending && pendingIp === row.ip ? '封鎖中…' : '一鍵封鎖'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
