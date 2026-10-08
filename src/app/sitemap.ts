import type { MetadataRoute } from 'next';

import { getPublished, getPublishedPair } from '@/lib/documents';
import { PUBLIC_PATHS, getSiteUrl } from '@/lib/site';

/**
 * `export const dynamic = 'force-dynamic'` 有兩個理由：
 * 1. `getSiteUrl()` 讀的 `PUBLIC_HOST` 只有在執行期才會就緒，不能被
 *    Next.js 在建置階段快取成靜態內容。
 * 2. 下面要查資料庫取得各文件的生效日期，資料庫在建置階段（例如容器
 *    建置）通常連不上，必須延到執行期才查。
 */
export const dynamic = 'force-dynamic';

function later(a?: Date | null, b?: Date | null): Date | undefined {
  if (a && b) return a > b ? a : b;
  return a ?? b ?? undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const lastModifiedByPath: Partial<Record<(typeof PUBLIC_PATHS)[number], Date>> = {};

  try {
    const [{ checklist, regulation }, terms, privacy] = await Promise.all([
      getPublishedPair(),
      getPublished('terms'),
      getPublished('privacy'),
    ]);

    const regulationsModified = later(checklist?.publishedAt, regulation?.publishedAt);
    if (regulationsModified) {
      lastModifiedByPath['/regulations'] = regulationsModified;
    }
    if (terms?.publishedAt) {
      lastModifiedByPath['/terms'] = terms.publishedAt;
    }
    if (privacy?.publishedAt) {
      lastModifiedByPath['/privacy'] = privacy.publishedAt;
    }
  } catch {
    // 資料庫讀不到時不能讓 sitemap 回 500：攔下錯誤，省略 lastModified，
    // 照常輸出五個公開頁的網址。
  }

  // 首頁刻意不給 lastModified：它的內容是操作介面本身，不是會定期更新的
  // 文件，硬湊一個日期反而是誤導搜尋引擎。
  return PUBLIC_PATHS.map((path) => ({
    url: `${siteUrl}${path}`,
    ...(lastModifiedByPath[path] ? { lastModified: lastModifiedByPath[path] } : {}),
  }));
}
