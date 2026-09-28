import type { Metadata } from 'next';

import { HomeClient } from '@/components/home-client';
import { JsonLd } from '@/components/json-ld';
import { FAQ_ITEMS } from '@/lib/faq';
import { SITE_DESCRIPTION, SITE_NAME, buildPageMetadata, getOperatorName, getSiteUrl } from '@/lib/site';

/**
 * 首頁。
 *
 * 原本的內容（上傳、貼字、送出分析）整段搬到 `src/components/home-client.tsx`
 * （`'use client'`）：metadata 與 JSON-LD 只能從伺服器元件匯出，而互動邏輯
 * 需要 `useState`／`useEffect`，兩者不能出現在同一個檔案。這裡改當伺服器
 * 元件，只負責 metadata、JSON-LD，畫面實際內容交給 `HomeClient`。
 *
 * `generateMetadata`／`getSiteUrl()` 都要在執行期才求值，理由與
 * `src/lib/site.ts` 的說明相同：Docker 建置階段沒有 `PUBLIC_HOST`。
 * 這裡用 `export const dynamic = 'force-dynamic'` 確保 Next.js 不會在
 * 建置階段預先產生這一頁、把當下（通常是 localhost）的網址烤進輸出。
 */
export const dynamic = 'force-dynamic';

const HOME_TITLE = '交友合約健檢｜交友媒合服務契約線上檢核';

export function generateMetadata(): Metadata {
  const metadata = buildPageMetadata({
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    path: '/',
  });

  return {
    ...metadata,
    // 首頁的標題要完全照規格書指定的字串顯示，不要被根 layout 的
    // `title.template`（`%s ｜ 交友合約健檢`）再包一層變成重複的站名。
    title: { absolute: HOME_TITLE },
  };
}

export default function HomePage() {
  const siteUrl = getSiteUrl();
  const operatorName = getOperatorName();

  const webApplicationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    url: siteUrl,
    description: SITE_DESCRIPTION,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Web',
    inLanguage: 'zh-Hant-TW',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'TWD',
    },
    ...(operatorName
      ? {
          publisher: {
            '@type': 'Organization',
            name: operatorName,
          },
        }
      : {}),
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <>
      <JsonLd data={webApplicationJsonLd} />
      <JsonLd data={faqJsonLd} />
      <HomeClient />
    </>
  );
}
