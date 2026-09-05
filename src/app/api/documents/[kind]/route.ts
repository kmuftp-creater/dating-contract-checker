import { NextResponse, type NextRequest } from 'next/server';

import { getPublished } from '@/lib/documents';
import type { DocumentKind } from '@/lib/types';

/**
 * 前台的法規文件查詢 API。
 *
 * 只在前台網域可用：`src/proxy.ts` 已經把 `/admincenter` 以外的路徑分流到
 * 前台網域，這支路由不必再自行判斷主機名稱。
 *
 * 2026-09-04 User 裁決：檔案下載改由官方網站提供，本站不再供檔，
 * 因此只保留 `format=json`，原本的 `md`（下載 markdown）與
 * `original`（下載官方原檔）兩種格式已移除。
 */

function isDocumentKind(value: string): value is DocumentKind {
  return value === 'checklist' || value === 'regulation';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (!isDocumentKind(kind)) {
    return NextResponse.json({ error: '不支援的文件種類。' }, { status: 404 });
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'json';
  if (format !== 'json') {
    return NextResponse.json({ error: '不支援的格式，僅提供 format=json。' }, { status: 400 });
  }

  const document = await getPublished(kind);
  if (!document) {
    return NextResponse.json({ error: '目前尚未設定生效版本。' }, { status: 404 });
  }

  return NextResponse.json({
    kind,
    version: document.version,
    publishedAt: document.publishedAt,
    note: document.note,
    markdown: document.markdown,
    sourceUrl: document.sourceUrl,
    sourceLabel: document.sourceLabel,
  });
}
