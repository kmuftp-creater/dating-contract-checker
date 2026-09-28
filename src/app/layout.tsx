import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';

import { ThemeScript } from '@/components/theme-script';
import { SITE_DESCRIPTION, SITE_NAME, getSiteUrl } from '@/lib/site';
import './globals.css';

/**
 * 根 layout 的 metadata 改用 `generateMetadata()`，理由是 `metadataBase`
 * 與 `openGraph.url` 都要用到 `getSiteUrl()`，而 `getSiteUrl()` 讀的
 * `PUBLIC_HOST` 只有在執行期（容器真正啟動後）才會就緒——Docker 建置階段
 * 沒有設定這個變數。若寫成模組頂層的靜態 `metadata` 物件，這段程式碼在
 * 建置時就可能被求值一次並快取下來，之後不管執行期給了什麼 `PUBLIC_HOST`
 * 都不會反映。
 *
 * `connection()` 明確告訴 Next.js「這段渲染要等到真正收到請求才能繼續」，
 * 藉此排除被建置階段預先產生、烤進錯誤網址的可能性。
 *
 * 注意：這裡刻意不設 `alternates.canonical`。根 layout 的 metadata 會被
 * 所有子頁繼承，若在這裡寫死一個 canonical，等於讓每一個子頁在沒有自己
 * 覆寫的情況下都指向同一個（錯誤的）網址。canonical 交給各頁自己的
 * metadata（見 `src/lib/site.ts` 的 `buildPageMetadata`）。
 */
export async function generateMetadata(): Promise<Metadata> {
  await connection();

  const siteUrl = getSiteUrl();

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: SITE_NAME,
      template: `%s ｜ ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    openGraph: {
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      url: siteUrl,
      siteName: SITE_NAME,
      locale: 'zh_TW',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
