import { ArrowLeft, Download, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { MarkdownView } from '@/components/markdown-view';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { getPublishedPair } from '@/lib/documents';
import { DOCUMENT_DESCRIPTIONS, DOCUMENT_LABELS } from '@/lib/document-labels';
import type { DocumentKind } from '@/lib/types';

export const metadata = { title: '法規文件' };

/**
 * 這一頁的內容來自資料庫，管理員在後台發布新版後應立即反映。
 *
 * 不加這一行的話 Next.js 會在建置時就把它靜態產生：部署後看到的永遠是
 * 建置當下的快照，管理員更新法規也不會變；而且建置階段會去連資料庫，
 * 在沒有資料庫的環境（例如容器建置）直接失敗。
 */
export const dynamic = 'force-dynamic';

function formatDate(date: Date | null): string {
  if (!date) return '尚未發布';
  return date.toLocaleDateString('zh-TW');
}

export default async function RegulationsPage() {
  const { checklist, regulation } = await getPublishedPair();
  const sections: { kind: DocumentKind; document: typeof checklist }[] = [
    { kind: 'checklist', document: checklist },
    { kind: 'regulation', document: regulation },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
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
          <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">法規文件</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            以下是目前生效的查核依據，分析永遠採用這裡列出的版本。
            要下載官方原始檔案，請用各段落的「到官方網站下載」按鈕前往發布機關的頁面，
            那裡才有最新版本。
          </p>
        </div>

        {sections.map(({ kind, document }) => (
          <section key={kind} className="card overflow-hidden">
            <div className="border-b border-hairline p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold text-ink sm:text-xl">{DOCUMENT_LABELS[kind]}</h2>
                {document && (
                  <span className="text-sm text-ink-muted">
                    第 {document.version} 版　生效日期：{formatDate(document.publishedAt)}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-ink-muted">{DOCUMENT_DESCRIPTIONS[kind]}</p>

              {document?.sourceUrl ? (
                <div className="mt-4">
                  {/*
                    先前這個連結長得像一段說明文字，使用者不會發現可以點。
                    改成主要按鈕樣式，並在文案上直接寫「下載」。
                  */}
                  <a
                    href={document.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary w-full sm:w-auto"
                  >
                    <Download className="size-4" aria-hidden />
                    到官方網站下載原始檔案
                    <ExternalLink className="size-3.5 opacity-70" aria-hidden />
                  </a>
                  <p className="mt-2 text-xs text-ink-muted">
                    來源：{document.sourceLabel || document.sourceUrl}
                    　（會開啟新分頁）
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-sm text-ink-muted">官方來源連結尚未設定。</p>
              )}
            </div>

            {document ? (
              <div className="p-5 sm:p-6">
                <p className="mb-3 text-sm font-medium text-ink">內容全文</p>
                <div className="max-h-[70vh] overflow-y-auto rounded-(--radius-control) border border-hairline bg-canvas p-4">
                  <MarkdownView markdown={document.markdown} />
                </div>
              </div>
            ) : (
              <div className="p-5 sm:p-6">
                <p className="rounded-(--radius-control) border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
                  目前尚未設定生效版本，前台無法進行分析。
                </p>
              </div>
            )}
          </section>
        ))}
      </main>

      <SiteFooter />
    </div>
  );
}
