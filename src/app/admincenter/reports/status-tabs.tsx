import Link from 'next/link';

import type { ReportStatus } from '@/lib/types';

/** 「問題回報」頁的狀態篩選頁籤，純連結導覽，不需要用戶端狀態。 */

const TABS: { value: ReportStatus | undefined; label: string }[] = [
  { value: undefined, label: '全部' },
  { value: 'open', label: '未處理' },
  { value: 'replied', label: '已回覆' },
  { value: 'closed', label: '已結案' },
];

export function ReportsStatusTabs({ current }: { current: ReportStatus | undefined }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const href = tab.value ? `/admincenter/reports?status=${tab.value}` : '/admincenter/reports';
        const active = tab.value === current;
        return (
          <Link
            key={tab.label}
            href={href}
            className={
              active
                ? 'rounded-(--radius-control) bg-brand px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-(--radius-control) border border-hairline px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink'
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
