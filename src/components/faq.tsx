import Link from 'next/link';

import { FAQ_ITEMS } from '@/lib/faq';

/**
 * 首頁常見問題。
 *
 * 用原生 `<details>`／`<summary>` 做展開收合，不依賴任何 JavaScript：
 * 答案文字一律直接存在於伺服器輸出的 HTML 裡，搜尋引擎與 AI 爬蟲讀取
 * 頁面原始碼（不執行 JavaScript）時就看得到完整內容，不必等瀏覽器
 * 執行完 hydration 才把文字補進 DOM。
 *
 * 內容對應內政部 115 年 5 月 8 日公告版本，見 `src/lib/faq.ts` 檔頭註解；
 * 法規修訂時要同步更新那份資料。
 */
export function Faq() {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-ink">常見問題</h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        以下內容依內政部 115 年 5 月 8 日公告版本整理，每題附條文出處；實際規定以官方公告為準，詳見
        <Link href="/regulations" className="text-brand hover:underline">
          法規文件
        </Link>
        。
      </p>

      <div className="mt-4 space-y-3">
        {FAQ_ITEMS.map((item) => (
          <details key={item.question} className="rounded-(--radius-control) border border-hairline p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">{item.question}</summary>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.answer}</p>
            <p className="mt-1.5 text-xs text-ink-muted">出處：{item.source}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
