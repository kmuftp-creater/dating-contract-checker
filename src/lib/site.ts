import 'server-only';

import type { Metadata } from 'next';

/**
 * 網站層級的常數與 metadata 輔助函式，供 SEO／AEO／GEO 相關檔案共用：
 * 根 layout、四個公開頁的 metadata、`robots.ts`、`sitemap.ts`、
 * `llms.txt`、JSON-LD 都從這裡取值，避免站名、說明文字、網址組法
 * 分散在各檔案各寫一份、改一個地方忘了改另一個。
 *
 * 刻意不匯入 `@/lib/env`：那個檔案標了 `server-only` 且缺環境變數會
 * 直接拋錯（例如 DATABASE_URL、AUTH_SECRET），這在只需要 PUBLIC_HOST
 * 的情境下（例如建置階段的靜態分析）會造成不必要的失敗。這裡直接讀
 * `process.env`。
 */

/** 服務名稱，用於 <title>、Open Graph、JSON-LD。 */
export const SITE_NAME = '交友合約健檢';

/** 服務的一句話說明，用於 <meta name="description"> 與 Open Graph。 */
export const SITE_DESCRIPTION =
  '依內政部公告的「交友媒合服務定型化契約查核表」與「交友媒合服務定型化契約應記載及不得記載事項」，免費、不需註冊，線上逐條檢核交友媒合服務契約。';

/**
 * 公開頁路徑清單。
 *
 * 「公開」指不禁止搜尋引擎索引的頁面；`/history`、`/history/[id]`、
 * `/report`、`/admincenter` 都不在這裡，它們的保護方式見
 * `src/app/robots.ts`、`next.config.ts` 的 `headers()`，以及各自頁面的
 * `robots` metadata。
 */
export const PUBLIC_PATHS = ['/', '/regulations', '/terms', '/privacy'] as const;

export type PublicPath = (typeof PUBLIC_PATHS)[number];

/**
 * 取得正式網站網址（不含結尾斜線）。
 *
 * 必須寫成函式、在「呼叫當下」才讀取 `process.env.PUBLIC_HOST`，
 * 不能在模組頂層算好存成常數：Docker 建置階段沒有設定 `PUBLIC_HOST`，
 * 若在模組載入時就求值，算出來的值會被當成模組的初始狀態一路沿用，
 * 之後容器真正啟動、環境變數就緒時也不會重新計算，等於把建置當下的
 * （通常是 localhost）網址烤進正式環境的輸出。
 *
 * 呼叫端也必須配合：只能在 request-time 才會執行的地方呼叫這個函式
 * （例如標了 `force-dynamic` 的頁面、Route Handler、`generateMetadata`），
 * 不能把回傳值存進在模組頂層就求值的常數。
 */
export function getSiteUrl(): string {
  const host = (process.env.PUBLIC_HOST ?? 'localhost:3400').trim();
  const hostname = host.split(':')[0]?.toLowerCase() ?? '';
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const protocol = isLocal ? 'http' : 'https';
  return `${protocol}://${host}`;
}

/**
 * 營運本服務的單位名稱。沒有設定 `OPERATOR_NAME` 時回傳 `null`，
 * 呼叫端據此決定要不要輸出（例如 JSON-LD 的 `publisher`、llms.txt 的
 * 「營運單位」段落），而不是印出一句「未設定」之類的占位字樣。
 *
 * 讀法沿用 `src/lib/legal.ts` 對同一個環境變數的處理方式（trim 後檢查
 * 是否為空字串），差別只在那裡找不到值時回退成中性說明文字，這裡回傳
 * `null` 交給呼叫端決定。
 */
export function getOperatorName(): string | null {
  const value = process.env.OPERATOR_NAME?.trim();
  return value ? value : null;
}

/** `buildPageMetadata` 的輸入。 */
export interface PageMetadataOptions {
  /** 頁面標題。會套用根 layout 的 `title.template`，除非呼叫端另外覆寫。 */
  title: string;
  /** 這一頁的具體描述，用於 `<meta name="description">` 與 Open Graph。 */
  description: string;
  /** 這一頁的路徑，例如 `/regulations`。 */
  path: string;
}

/**
 * 產生單一頁面共用的 metadata：canonical、Open Graph、Twitter Card。
 *
 * 網址一律組成完整的絕對網址（呼叫 `getSiteUrl()`），不依賴根 layout 的
 * `metadataBase` 做相對路徑解析：兩者本應等價，但這裡的頁面又大多本來
 * 就需要在 request time 重新計算網址（見 `getSiteUrl` 的說明），直接算好
 * 絕對網址比較不會因為 metadata 合併規則的細節而意外退回相對路徑。
 */
export function buildPageMetadata(options: PageMetadataOptions): Metadata {
  const siteUrl = getSiteUrl();
  const url = `${siteUrl}${options.path}`;

  /**
   * 分享圖必須在這裡明確列出，不能只靠 `src/app/opengraph-image.png`。
   *
   * Next.js 的 metadata 是淺層合併：頁面只要宣告了 `openGraph`，就會把
   * 上層的 `openGraph` 整個換掉，連同檔案慣例帶進來的圖片一起消失。
   * 2026-09-29 部署後實測，首頁有 `og:image`，其餘三個公開頁都沒有，
   * 分享到 LINE、Facebook 時就沒有預覽圖。
   */
  const images = [
    {
      url: `${siteUrl}/opengraph-image.png`,
      width: 1200,
      height: 630,
      alt: `${SITE_NAME}：依內政部公告逐條檢核交友媒合服務契約`,
    },
  ];

  return {
    title: options.title,
    description: options.description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: options.title,
      description: options.description,
      url,
      siteName: SITE_NAME,
      locale: 'zh_TW',
      type: 'website',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: options.title,
      description: options.description,
      images,
    },
  };
}
