import type { Metadata } from 'next';

/**
 * `/report`（問題回報）的內容因人而異、與查核契約無關，不該被搜尋引擎
 * 索引。`page.tsx` 是 `'use client'`，metadata 只能從伺服器元件匯出，
 * 所以放在這一層 layout。
 *
 * 對應的 `X-Robots-Tag` 回應標頭另外設在 `next.config.ts` 的 `headers()`。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
