import type { Metadata } from 'next';

/**
 * `/history` 與 `/history/[id]` 都是使用者自己的分析紀錄，不是給搜尋引擎
 * 看的公開內容，一律加上 noindex。
 *
 * 放在這一層 layout 而不是各自的 `page.tsx`：列表頁 `/history/page.tsx`
 * 是 `'use client'`，伺服器元件才能匯出 metadata，用 layout 一次涵蓋
 * 兩個路徑，比兩邊各自想辦法可靠。
 *
 * 對應的 `X-Robots-Tag` 回應標頭另外設在 `next.config.ts` 的 `headers()`：
 * 兩者互為備援——`<meta name="robots">` 只有真正解析 HTML 的爬蟲看得到，
 * 標頭則連只看回應標頭、不解析內容的工具都擋得住。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
