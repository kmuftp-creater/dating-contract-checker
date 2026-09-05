import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/auth';
import { getPublished, listVersions } from '@/lib/documents';
import { ALL_DOCUMENT_KINDS, DOCUMENT_DESCRIPTIONS, DOCUMENT_LABELS } from '@/lib/document-labels';
import type { DocumentKind } from '@/lib/types';

export const metadata = { title: '法規文件' };


const KINDS: DocumentKind[] = ALL_DOCUMENT_KINDS;

function formatDateTime(date: Date | null): string {
  if (!date) return '－';
  return date.toLocaleString('zh-TW', { hour12: false });
}

export default async function AdminDocumentsPage() {
  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const cards = await Promise.all(
    KINDS.map(async (kind) => {
      const [published, versions] = await Promise.all([getPublished(kind), listVersions(kind)]);
      return { kind, published, totalVersions: versions.length };
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">法規文件</h1>
        <p className="mt-1 text-sm text-ink-muted">
          查核表與公告全文各自獨立管理版本，前台分析只採用「目前生效版本」。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map(({ kind, published, totalVersions }) => (
          <div key={kind} className="card p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">{DOCUMENT_LABELS[kind]}</h2>
              <Link
                href={`/admincenter/documents/${kind}`}
                className="rounded-(--radius-control) border border-hairline px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-brand"
              >
                編輯
              </Link>
            </div>

            <p className="mt-1 text-sm text-ink-muted">{DOCUMENT_DESCRIPTIONS[kind]}</p>

            {published ? (
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">目前生效版本</dt>
                  <dd className="text-ink">第 {published.version} 版</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">發布時間</dt>
                  <dd className="text-ink">{formatDateTime(published.publishedAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Markdown 字數</dt>
                  <dd className="text-ink">{published.markdown.trim().length} 字</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">官方原檔</dt>
                  <dd className="text-ink">{published.attachmentPath ? '已附上' : '無'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">版本總數</dt>
                  <dd className="text-ink">{totalVersions} 個</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 rounded-(--radius-control) border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
                尚未設定，前台分析會無法進行。
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
