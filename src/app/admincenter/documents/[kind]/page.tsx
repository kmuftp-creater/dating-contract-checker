import { notFound, redirect } from 'next/navigation';

import { requireAdmin } from '@/auth';
import { listVersions } from '@/lib/documents';
import { DOCUMENT_LABELS, isDocumentKind } from '@/lib/document-labels';

import type { DocumentVersionView } from '../actions';
import { DocumentEditor } from './editor';


export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  return { title: isDocumentKind(kind) ? DOCUMENT_LABELS[kind] : '法規文件' };
}

export default async function DocumentEditPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  if (!isDocumentKind(kind)) {
    notFound();
  }

  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const rows = await listVersions(kind);
  const versions: DocumentVersionView[] = rows.map((row) => ({
    id: row.id,
    version: row.version,
    markdown: row.markdown,
    attachmentPath: row.attachmentPath,
    sourceUrl: row.sourceUrl,
    sourceLabel: row.sourceLabel,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{DOCUMENT_LABELS[kind]}編輯</h1>
        <p className="mt-1 text-sm text-ink-muted">
          左側編輯 markdown 內容，右側即時預覽。發布為不可逆動作，發布前需二次確認。
        </p>
      </div>

      <DocumentEditor kind={kind} versions={versions} />
    </div>
  );
}
