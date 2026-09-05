'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';
import { getQuota } from '@/lib/client/api';
import type { QuotaResponse } from '@/lib/api-contract';

/**
 * 共用頁首：站名、導覽、今日剩餘次數、亮暗模式切換。
 *
 * 每個掛載這個元件的頁面各自查一次今日剩餘次數並每 30 秒更新一次，
 * 讓使用者在切換頁面或分析完成後很快能看到扣除後的次數，不需要另外
 * 做跨元件的狀態共享。
 */

const NAV_ITEMS = [
  { href: '/', label: '分析' },
  { href: '/history', label: '歷史紀錄' },
  { href: '/regulations', label: '法規文件' },
  { href: '/report', label: '問題回報' },
];

const QUOTA_POLL_MS = 30_000;

export function SiteHeader() {
  const pathname = usePathname();
  const [quota, setQuota] = useState<QuotaResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getQuota();
        if (!cancelled) {
          setQuota(data);
        }
      } catch {
        // 讀取次數失敗不影響頁面其餘功能，靜默略過，下次輪詢再試。
      }
    }

    void load();
    const timer = setInterval(() => void load(), QUOTA_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <header className="border-b border-hairline bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold text-ink transition-colors hover:text-brand">
          交友合約健檢
        </Link>

        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'transition-colors hover:text-brand',
                pathname === item.href ? 'font-medium text-brand' : 'text-ink-muted',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span
            className={clsx(
              'text-sm',
              quota?.suspended ? 'font-medium text-danger' : 'text-ink-muted',
            )}
            title={quota?.message ?? undefined}
          >
            {quota
              ? quota.suspended
                ? '暫停使用中'
                : `今日剩餘 ${quota.remaining} 次`
              : '今日剩餘次數載入中…'}
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
