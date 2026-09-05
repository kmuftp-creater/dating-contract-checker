import { NextResponse, type NextRequest } from 'next/server';

import { requireAdmin } from '@/auth';
import { convertPdfToMarkdownDraft } from '@/lib/ai/pdf-to-markdown';
import { extractPdf } from '@/lib/extract/pdf';
import { getPublished } from '@/lib/documents';
import { getSetting } from '@/lib/settings';
import type { DocumentKind } from '@/lib/types';

/**
 * 後台「上傳 PDF 產生草稿」：接收 multipart 的 `file` 與 `kind`，
 * 抽出 PDF 文字後請 AI 照現行生效版本的格式重排成 markdown，
 * 只回傳草稿文字，不寫入資料庫（見設計文件第三章第 9-1 節）。
 *
 * 這支路由只在後台網域可用：`src/proxy.ts` 已經把 `/admincenter` 以外的路徑
 * 擋在後台網域之外，這裡不必再自行判斷主機名稱。
 */

function isDocumentKind(value: unknown): value is DocumentKind {
  return value === 'checklist' || value === 'regulation';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: '未登入或不在白名單內，無法執行此操作。' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json(
      { error: `無法解析上傳內容：${errorMessage(error)}` },
      { status: 400 },
    );
  }

  const kind = formData.get('kind');
  if (!isDocumentKind(kind)) {
    return NextResponse.json({ error: '不支援的文件種類。' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '請選擇要上傳的 PDF 檔案。' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let extracted: Awaited<ReturnType<typeof extractPdf>>;
  try {
    extracted = await extractPdf(buffer, file.name);
  } catch (error) {
    return NextResponse.json(
      { error: `PDF 文字抽取失敗：${errorMessage(error)}` },
      { status: 400 },
    );
  }

  if (extracted.method === 'ocr' || extracted.text.trim() === '') {
    return NextResponse.json(
      { error: '這份 PDF 沒有文字層，請改用可複製文字的版本。' },
      { status: 400 },
    );
  }

  const ai = await getSetting('ai');
  if (ai.gatewayUrl.trim() === '' || ai.apiKey.trim() === '') {
    return NextResponse.json(
      { error: 'AI 尚未設定，請先於 AI 服務管理頁面設定閘道網址與金鑰。' },
      { status: 400 },
    );
  }

  const published = await getPublished(kind);

  try {
    const draft = await convertPdfToMarkdownDraft({
      currentMarkdown: published?.markdown ?? '',
      pdfText: extracted.text,
      gateway: {
        baseUrl: ai.gatewayUrl,
        apiKey: ai.apiKey,
        model: ai.primaryModel,
      },
      clientId: ai.costClientId,
    });

    return NextResponse.json({
      markdown: draft.markdown,
      checklistIdCount: draft.checklistIdCount,
      model: draft.model,
    });
  } catch (error) {
    return NextResponse.json({ error: `AI 轉換失敗：${errorMessage(error)}` }, { status: 502 });
  }
}
