import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

import { getSiteUrl } from '@/lib/site';

/**
 * 依規格書「G」與 `src/proxy.ts` 的網域分流邏輯一起讀：
 * - 一般模式（後台與前台共用網址）：輸出下面的一般規則。
 * - 後台獨立網域模式（`ADMIN_HOST` 有值且不同於 `PUBLIC_HOST`）：
 *   當這次請求的 Host 就是 `ADMIN_HOST` 時，整站都不該被索引，也不需要
 *   提供 sitemap（後台網域上沒有公開頁面）。
 *
 * 呼叫 `headers()`（Request-time API）順便讓這個檔案不會被 Next.js
 * 在建置階段快取成靜態內容：`getSiteUrl()` 讀的 `PUBLIC_HOST` 只有在
 * 執行期才會就緒。
 */
export const dynamic = 'force-dynamic';

/**
 * 會主動抓取內容餵給大型語言模型的爬蟲。這份清單刻意獨立於一般搜尋引擎
 * 之外：即使不希望一般搜尋結果收錄某個路徑，也可能想讓 AI 助理讀得到
 * （或反過來）。目前兩邊的允許／禁止規則相同，各自維護是為了未來調整
 * 其中一邊時不必牽動另一邊。
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Amazonbot',
  'meta-externalagent',
  'Bytespider',
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headerList = await headers();
  const requestHost = (headerList.get('host') ?? '').toLowerCase();

  const publicHost = (process.env.PUBLIC_HOST ?? 'localhost:3400').toLowerCase();
  const adminHost = (process.env.ADMIN_HOST ?? '').toLowerCase().trim();
  const separateAdminHost = adminHost !== '' && adminHost !== publicHost;

  if (separateAdminHost && requestHost === adminHost) {
    // 後台獨立網域：整站不索引，也不提供 sitemap（沒有任何公開頁面）。
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        /**
         * 刻意不 disallow `/history` 與 `/report`。
         *
         * 被 `disallow` 的網址，搜尋引擎連內容都不會抓取，也就讀不到頁面
         * 裡的 `<meta name="robots" content="noindex">`；如果這種網址曾經
         * 外流過（例如被分享出去、被別的網站連結），它反而會以「裸網址、
         * 沒有標題與說明」的樣子出現在搜尋結果裡，比完全不擋還糟。
         *
         * 這兩個路徑改用 `<meta name="robots">`（見 `src/app/history/layout.tsx`
         * 與 `src/app/report/layout.tsx`）與 `X-Robots-Tag` 回應標頭
         * （見 `next.config.ts` 的 `headers()`）保護：兩者都要求先讀到內容
         * 才生效，效果是「讀得到但不收錄」，而不是「連讀都不讓讀」。
         */
        disallow: ['/admincenter', '/api/'],
      },
      {
        // AI 爬蟲不像一般搜尋引擎有「先讀到內容才看得到 noindex」的隱憂
        // ——目前沒有觀察到主要業者會像搜尋引擎一樣把 disallow 的網址原樣
        // 收錄進公開索引，這裡直接連 `/history`、`/report` 一併擋掉，
        // 避免使用者自己的分析紀錄與問題回報內容被拿去訓練或摘要。
        userAgent: AI_CRAWLERS,
        allow: '/',
        disallow: ['/admincenter', '/api/', '/history', '/report'],
      },
    ],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
