import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { FAQ_ITEMS } from '@/lib/faq';

/**
 * 首頁的常見問題入口。
 *
 * 首頁只列出問題標題，每一題連到常見問題頁的對應錨點（`/faq#<id>`），
 * 答案與 `FAQPage` JSON-LD 都只放在 `/faq`（見 `src/app/faq/page.tsx`）。
 * 同一份問答不在兩個網址重複輸出，搜尋引擎才不會把首頁與 `/faq`
 * 當成內容重複的頁面而分散權重。
 *
 * 問答內容對應內政部 115 年 5 月 8 日公告版本，見 `src/lib/faq.ts` 檔頭
 * 註解；法規修訂時要同步更新那份資料。
 */
export function Faq() {
  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-ink">常見問題</h2>

      <ul className="mt-4 space-y-1">
        {FAQ_ITEMS.map((item) => (
          <li key={item.id}>
            <Link
              href={`/faq#${item.id}`}
              className="flex items-start gap-1.5 rounded-(--radius-control) px-2 py-1.5 text-sm text-ink transition-colors hover:bg-canvas hover:text-brand"
            >
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
              {item.question}
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm">
        <Link href="/faq" className="text-brand hover:underline">
          查看全部常見問題
        </Link>
      </p>
    </section>
  );
}
