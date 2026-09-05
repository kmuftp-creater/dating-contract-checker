import Link from 'next/link';

import { IpAddress } from '@/components/ip-address';
import { redirect } from 'next/navigation';

import { listAnalyses, type AnalysisRecordFilter } from '@/lib/admin/records';
import { requireAdmin } from '@/auth';
import type { AnalysisMode, AnalysisStatus } from '@/lib/types';

import { AnalysesFilterBar } from './filter-bar';

/**
 * 「使用紀錄」列表頁。
 *
 * 對應設計文件第三章第 4 節。篩選條件與分頁都透過網址查詢字串傳遞，
 * 由這支伺服器元件依查詢字串呼叫 `listAnalyses` 取資料；互動的篩選列
 * 拆到 `filter-bar.tsx`（見該檔說明）。
 */

export const metadata = { title: '使用紀錄' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const MODE_LABEL: Record<AnalysisMode, string> = {
  merged: '合併為一份合約',
  separate: '各檔獨立分析',
};

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: '排隊中',
  running: '處理中',
  done: '完成',
  failed: '失敗',
};

const STATUS_COLOR: Record<AnalysisStatus, string> = {
  queued: 'text-ink-muted',
  running: 'text-info',
  done: 'text-ok',
  failed: 'text-danger',
};

function isStatus(value: string | undefined): value is AnalysisStatus {
  return value === 'queued' || value === 'running' || value === 'done' || value === 'failed';
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function formatUsd(value: number): string {
  return `US$ ${value.toFixed(4)}`;
}

function truncateId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

type SearchParams = Record<string, string | string[] | undefined>;

function pickString(sp: SearchParams, key: string): string | undefined {
  const value = sp[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function buildPageHref(filter: AnalysisRecordFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter.ip) params.set('ip', filter.ip);
  if (filter.dateFrom) params.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) params.set('dateTo', filter.dateTo);
  if (filter.status) params.set('status', filter.status);
  params.set('page', String(page));
  return `/admincenter/analyses?${params.toString()}`;
}

export default async function AnalysesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const sp = await searchParams;
  const filter: AnalysisRecordFilter = {
    ip: pickString(sp, 'ip'),
    dateFrom: pickString(sp, 'dateFrom'),
    dateTo: pickString(sp, 'dateTo'),
    status: isStatus(pickString(sp, 'status')) ? (pickString(sp, 'status') as AnalysisStatus) : undefined,
  };
  const pageParam = pickString(sp, 'page');
  const page = pageParam && Number.isInteger(Number(pageParam)) && Number(pageParam) > 0 ? Number(pageParam) : 1;

  const { rows, total } = await listAnalyses(filter, page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">使用紀錄</h1>
        <p className="mt-1 text-sm text-ink-muted">
          共 {total.toLocaleString('zh-Hant-TW')} 筆分析紀錄，可依 IP、日期區間、狀態篩選。
        </p>
      </div>

      <AnalysesFilterBar />

      {/*
        欄位從十欄壓成五欄，次要資訊改為堆疊在主欄位底下。
        原本每一欄都設了不換行，加上 IPv6 位址有四十個字元，
        任何螢幕寬度都會溢出、必須橫拖。資訊一項沒少，只是換了排法。
      */}
      <div className="card overflow-x-auto p-4">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[22%]" />
            <col className="w-[26%]" />
            <col className="w-[18%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-hairline text-ink-muted">
              <th className="px-3 py-2 font-semibold">時間</th>
              <th className="px-3 py-2 font-semibold">來源</th>
              <th className="px-3 py-2 font-semibold">內容</th>
              <th className="px-3 py-2 font-semibold">用量</th>
              <th className="px-3 py-2 font-semibold">結果</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-hairline align-top last:border-0">
                <td className="px-3 py-2 text-ink-muted">
                  <Link
                    href={`/admincenter/analyses/${row.id}`}
                    className="text-brand hover:underline"
                  >
                    {formatDateTime(row.createdAt)}
                  </Link>
                </td>

                <td className="px-3 py-2 text-ink">
                  {/* IPv6 位址很長，元件內用等寬字體並允許任意位置斷行 */}
                  <IpAddress value={row.ip} country={row.country} className="block" />
                  <span className="mt-0.5 block text-xs text-ink-muted" title={row.clientId}>
                    瀏覽器 {truncateId(row.clientId)}
                  </span>
                </td>

                <td className="px-3 py-2 text-ink">
                  <span className="block">
                    {MODE_LABEL[row.mode]}　{row.fileNames.length} 個檔案
                  </span>
                  {row.fileNames.length > 0 && (
                    <span className="mt-0.5 block text-xs break-words text-ink-muted">
                      {row.fileNames.join('、')}
                    </span>
                  )}
                </td>

                <td className="px-3 py-2 text-ink">
                  <span className="block text-xs break-words">{row.model ?? '－'}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {row.inputTokens ?? '－'} / {row.outputTokens ?? '－'} token
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {formatUsd(row.costEstimateUsd)}
                  </span>
                </td>

                <td className="px-3 py-2">
                  <span className={`block font-medium ${STATUS_COLOR[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                  {row.summary && (
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      符合 {row.summary.pass}／不符合 {row.summary.fail}／建議修正{' '}
                      {row.summary.fix}／不適用 {row.summary.na}
                    </span>
                  )}
                  {row.status === 'failed' && row.errorMessage && (
                    <span className="mt-0.5 block text-xs break-words text-danger">
                      {row.errorMessage}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                  沒有符合篩選條件的紀錄。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Link
            href={buildPageHref(filter, Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={`rounded-(--radius-control) border border-hairline px-3 py-1.5 ${
              page <= 1 ? 'pointer-events-none opacity-40' : 'text-ink hover:border-brand hover:text-brand'
            }`}
          >
            上一頁
          </Link>
          <span className="text-ink-muted">
            第 {page} 頁，共 {totalPages} 頁
          </span>
          <Link
            href={buildPageHref(filter, Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={`rounded-(--radius-control) border border-hairline px-3 py-1.5 ${
              page >= totalPages ? 'pointer-events-none opacity-40' : 'text-ink hover:border-brand hover:text-brand'
            }`}
          >
            下一頁
          </Link>
        </div>
      )}
    </div>
  );
}
