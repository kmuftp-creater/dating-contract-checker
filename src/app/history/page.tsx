'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import type { AnalysisListItem } from '@/lib/api-contract';
import { ApiClientError, listAnalyses } from '@/lib/client/api';
import type { AnalysisStatus } from '@/lib/types';

/**
 * 歷史紀錄列表：以瀏覽器識別碼（cookie）為準，只看得到這個瀏覽器
 * 建立過的分析。
 */

const MODE_LABEL = { merged: '合併為一份合約', separate: '各檔獨立分析' } as const;

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: '排隊中',
  running: '處理中',
  done: '已完成',
  failed: '失敗',
};

const STATUS_COLOR: Record<AnalysisStatus, string> = {
  queued: 'text-ink-muted',
  running: 'text-info',
  done: 'text-ok',
  failed: 'text-danger',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function HistoryPage() {
  const [items, setItems] = useState<AnalysisListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAnalyses()
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setCursor(data.nextCursor);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof ApiClientError ? error.message : '讀取歷史紀錄時發生錯誤。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    setLoadingMore(true);
    listAnalyses(cursor)
      .then((data) => {
        setItems((prev) => [...prev, ...data.items]);
        setCursor(data.nextCursor);
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof ApiClientError ? error.message : '讀取歷史紀錄時發生錯誤。');
      })
      .finally(() => setLoadingMore(false));
  }, [cursor]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-semibold">歷史紀錄</h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          這裡列出的是這個瀏覽器建立過的分析紀錄。紀錄綁定這個瀏覽器，換瀏覽器或清除瀏覽資料（含
          cookie）就看不到舊紀錄，請留意保存重要結果。
        </p>

        {loading && (
          <div className="card mt-6 flex items-center gap-2 p-6 text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            載入中…
          </div>
        )}

        {!loading && errorMessage && (
          <p className="card mt-6 p-6 text-danger">{errorMessage}</p>
        )}

        {!loading && !errorMessage && items.length === 0 && (
          <p className="card mt-6 p-6 text-ink-muted">目前還沒有任何分析紀錄。</p>
        )}

        {!loading && items.length > 0 && (
          <ul className="mt-6 space-y-3">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/history/${item.id}`}
                  className="card flex flex-col gap-2 p-4 transition-colors hover:border-brand sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {item.fileNames.length > 0 ? item.fileNames.join('、') : '（貼上的文字）'}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatDateTime(item.createdAt)}　{MODE_LABEL[item.mode]}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm">
                    {item.summary && (
                      <span className="text-ink-muted">
                        符合 {item.summary.pass}／不符合 {item.summary.fail}／建議修正 {item.summary.fix}／不適用{' '}
                        {item.summary.na}
                      </span>
                    )}
                    <span className={`font-medium ${STATUS_COLOR[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {cursor && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-4 rounded-(--radius-control) border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {loadingMore ? '載入中…' : '載入更多'}
          </button>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
