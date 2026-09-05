'use client';

import { Download, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/**
 * 「使用紀錄」頁的篩選列與匯出按鈕。
 *
 * 篩選條件寫入網址查詢字串（`router.push` 帶新的 query），重新整理後
 * `page.tsx` 會依查詢字串重新查詢，篩選條件因此得以保存。
 * 「匯出 CSV」直接沿用目前網址上的查詢字串（不含分頁），確保「畫面上
 * 看到的篩選條件」與「匯出的資料」一致。
 */

const STATUS_OPTIONS = [
  { value: '', label: '全部狀態' },
  { value: 'queued', label: '排隊中' },
  { value: 'running', label: '處理中' },
  { value: 'done', label: '完成' },
  { value: 'failed', label: '失敗' },
] as const;

export function AnalysesFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [ip, setIp] = useState(searchParams.get('ip') ?? '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');

  function applyFilter(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams();
    if (ip.trim() !== '') params.set('ip', ip.trim());
    if (dateFrom !== '') params.set('dateFrom', dateFrom);
    if (dateTo !== '') params.set('dateTo', dateTo);
    if (status !== '') params.set('status', status);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearFilter(): void {
    setIp('');
    setDateFrom('');
    setDateTo('');
    setStatus('');
    router.push(pathname);
  }

  const exportParams = new URLSearchParams(searchParams.toString());
  exportParams.delete('page');
  const exportHref = `/admincenter/api/export/analyses${exportParams.toString() ? `?${exportParams.toString()}` : ''}`;

  return (
    <form onSubmit={applyFilter} className="card flex flex-wrap items-end gap-3 p-4">
      <div>
        <label htmlFor="filter-ip" className="mb-1 block text-xs text-ink-muted">
          IP
        </label>
        <input
          id="filter-ip"
          type="text"
          value={ip}
          onChange={(event) => setIp(event.target.value)}
          placeholder="例如 203.0.113.5"
          className="w-40 rounded-(--radius-control) border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <div>
        <label htmlFor="filter-date-from" className="mb-1 block text-xs text-ink-muted">
          日期起
        </label>
        <input
          id="filter-date-from"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className="rounded-(--radius-control) border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <div>
        <label htmlFor="filter-date-to" className="mb-1 block text-xs text-ink-muted">
          日期迄
        </label>
        <input
          id="filter-date-to"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className="rounded-(--radius-control) border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink"
        />
      </div>
      <div>
        <label htmlFor="filter-status" className="mb-1 block text-xs text-ink-muted">
          狀態
        </label>
        <select
          id="filter-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-(--radius-control) border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-(--radius-control) bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
      >
        <Search className="size-4" aria-hidden />
        套用篩選
      </button>

      <button
        type="button"
        onClick={clearFilter}
        className="rounded-(--radius-control) border border-hairline px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        清除
      </button>

      <a
        href={exportHref}
        className="ml-auto inline-flex items-center gap-1.5 rounded-(--radius-control) border border-hairline px-3 py-2 text-sm text-ink transition-colors hover:border-brand hover:text-brand"
      >
        <Download className="size-4" aria-hidden />
        匯出 CSV
      </a>
    </form>
  );
}
