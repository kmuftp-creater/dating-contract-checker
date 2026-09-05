import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { MarkdownView } from '@/components/markdown-view';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { DOCUMENT_LABELS } from '@/lib/document-labels';
import { getPublished } from '@/lib/documents';
import { renderLegalMarkdown } from '@/lib/legal';
import type { DocumentKind } from '@/lib/types';

/**
 * 隱私權政策與服務條款的頁面。
 *
 * 內容存在資料庫，由管理員在後台的「法規文件」編輯（與查核表共用同一套
 * 版本管理與發布流程）。其中的數字用變數帶入目前的系統設定，避免條款寫的
 * 值與實際不符，細節見 `src/lib/legal.ts`。
 */
export async function LegalDocumentPage({ kind }: { kind: DocumentKind }) {
  const document = await getPublished(kind);
  const title = DOCUMENT_LABELS[kind];

  const body = document ? await renderLegalMarkdown(document.markdown) : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden />
          回首頁
        </Link>

        {document ? (
          <>
            <p className="mt-4 text-sm text-ink-muted">
              第 {document.version} 版
              {document.publishedAt
                ? `　更新日期：${document.publishedAt.toLocaleDateString('zh-TW')}`
                : '　尚未發布'}
            </p>
            <article className="mt-4">
              <MarkdownView markdown={body ?? ''} />
            </article>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{title}</h1>
            <p className="mt-4 rounded-(--radius-control) border border-warn/50 bg-warn/10 p-4 text-sm text-ink">
              目前尚未設定{title}的內容。管理員可在後台的「法規文件」頁面新增並發布。
            </p>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
