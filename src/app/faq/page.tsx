import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { JsonLd } from '@/components/json-ld';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { FAQ_ITEMS } from '@/lib/faq';
import { SITE_NAME, buildPageMetadata, getSiteUrl } from '@/lib/site';

/**
 * 這一頁的內容雖然是靜態資料（`src/lib/faq.ts`），仍要加 `force-dynamic`：
 * 下方 `generateMetadata` 與 JSON-LD 都會呼叫 `getSiteUrl()`，它讀的
 * `PUBLIC_HOST` 在 Docker 建置階段不存在，若讓 Next.js 在建置時預先產生
 * 這一頁，就會把當下（通常是 localhost）的網址烤進 canonical、og:url 與
 * 結構化資料裡，部署後也不會更新。理由詳見 `src/lib/site.ts`。
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: '常見問題',
    description:
      '整理交友媒合服務契約的審閱期、退費、手續費與違約金上限、入會費、履約保障等常見問題，每題附條文出處，依內政部 115 年 5 月 8 日公告版本。',
    path: '/faq',
  });
}

export default function FaqPage() {
  const siteUrl = getSiteUrl();
  const pageUrl = `${siteUrl}/faq`;

  // 問答文字直接取自 FAQ_ITEMS，與畫面上顯示的是同一份資料；
  // 結構化資料與可視內容不一致，搜尋引擎可能判定為誤導而忽略。
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

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: siteUrl },
      { '@type': 'ListItem', position: 2, name: '常見問題', item: pageUrl },
    ],
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={faqJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:py-10">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-brand"
          >
            <ArrowLeft className="size-4" aria-hidden />
            回首頁
          </Link>
          <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">常見問題</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            以下內容依內政部 115 年 5 月 8 日公告版本整理，每題附條文出處；實際規定以官方公告為準，詳見
            <Link href="/regulations" className="text-brand hover:underline">
              法規文件
            </Link>
            。
          </p>
        </div>

        {/*
          九題全部展開，不用 `<details>`：答案直接存在於 HTML，使用者不必逐題點開，
          錨點跳轉（`/faq#refund`）也一定落在看得到內容的位置。
          `scroll-mt-24` 預留頁首高度，避免跳轉後標題被頁首遮住。
        */}
        <div className="space-y-4">
          {FAQ_ITEMS.map((item) => (
            <section key={item.id} id={item.id} className="card scroll-mt-24 p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-ink sm:text-xl">{item.question}</h2>
              <p className="mt-3 leading-relaxed text-ink-muted">{item.answer}</p>
              <p className="mt-3 text-xs text-ink-muted">出處：{item.source}</p>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
