import { NextResponse, type NextRequest } from 'next/server';

import type { UploadFileResponse } from '@/lib/api-contract';
import { detectCategory, detectFormat, extractFile, toArchive, type DetectedFormat } from '@/lib/extract';
import { checkUploadAllowed } from '@/lib/guard';
import { ensureClient } from '@/lib/guard/client';
import { normalizeIp } from '@/lib/guard/ip';
import { recordEvent } from '@/lib/guard/window';
import { errorResponse, getClientIp, getOrCreateClientId, guardToError, setClientCookie } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { savePending } from '@/lib/storage';

/**
 * `POST /api/files`：上傳單一檔案，抽取內容後暫存，回傳檔案 id。
 *
 * 這一步還不會建立 `analyses` 紀錄（見 `src/lib/storage.ts` 開頭的說明），
 * 使用者按「分析」時才由 `POST /api/analyses` 把暫存內容正式歸檔。
 */

const FORMAT_TO_MIME: Record<DetectedFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawIp = getClientIp(request);
  const { clientId, isNew } = getOrCreateClientId(request);

  const guardResult = await checkUploadAllowed({ ip: rawIp, clientId });
  if (!guardResult.allowed) {
    return guardToError(guardResult);
  }

  const ip = normalizeIp(rawIp) ?? rawIp;
  await ensureClient(clientId, ip, request.headers.get('user-agent'));

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse('bad_request', '無法解析上傳內容，請確認送出的是 multipart/form-data。', 400);
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return errorResponse('bad_request', '缺少檔案欄位 file。', 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name || '未命名檔案';

  const rules = await getSetting('abuse_rules');
  const format = detectFormat(filename, buffer);
  const category = detectCategory(filename, buffer);

  if (category) {
    const limit = category === 'image' ? rules.maxImageBytes : rules.maxDocumentBytes;
    if (buffer.length > limit) {
      await recordEvent(ip, 'rejected');
      return errorResponse(
        'file_too_large',
        `檔案大小超過上限（上限 ${formatBytes(limit)}）。`,
        400,
      );
    }
  }

  let extractResult: Awaited<ReturnType<typeof extractFile>>;
  try {
    extractResult = await extractFile(buffer, filename);
  } catch (error) {
    await recordEvent(ip, 'rejected');
    return errorResponse('unsupported_file', errorMessage(error), 400);
  }

  let archive: Awaited<ReturnType<typeof toArchive>>;
  try {
    archive = await toArchive(buffer, filename);
  } catch (error) {
    await recordEvent(ip, 'rejected');
    return errorResponse('unsupported_file', errorMessage(error), 400);
  }

  const mime = format ? FORMAT_TO_MIME[format] : 'application/octet-stream';

  const pending = await savePending({
    originalName: filename,
    mime,
    size: buffer.length,
    category: category ?? 'text',
    extractMethod: extractResult.method,
    pageCount: extractResult.pageCount,
    notes: extractResult.notes,
    text: extractResult.text,
    images: extractResult.images,
    archive,
  });

  await recordEvent(ip, 'upload');

  const body: UploadFileResponse = {
    fileId: pending.fileId,
    name: pending.originalName,
    size: pending.size,
    category: pending.category,
    extractMethod: pending.extractMethod,
    pageCount: pending.pageCount,
    notes: pending.notes,
  };

  const response = NextResponse.json(body, { status: 200 });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}
