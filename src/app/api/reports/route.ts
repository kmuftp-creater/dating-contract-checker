import { desc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { db, schema } from '@/db';
import type { CreateReportResponse, ReportListItem, ReportListResponse } from '@/lib/api-contract';
import { detectCategory, toArchive } from '@/lib/extract';
import { checkUploadAllowed } from '@/lib/guard';
import { ensureClient } from '@/lib/guard/client';
import { isBlocked, isEmailBlocked, normalizeIp } from '@/lib/guard/ip';
import { recordEvent } from '@/lib/guard/window';
import { errorResponse, getClientIp, getOrCreateClientId, guardToError, setClientCookie } from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { saveReportScreenshot } from '@/lib/storage';

/**
 * `POST /api/reports`：送出問題回報，格式為 multipart/form-data
 *   （欄位與選填的截圖檔案 `screenshot` 一起送出，見 `api-contract.ts`）。
 * `GET /api/reports`：查自己（依瀏覽器識別碼）送出的回報與回覆。
 */

const REPORT_CATEGORIES = ['wrong_result', 'upload_failed', 'regulation_error', 'other'] as const;

const fieldsSchema = z.object({
  category: z.enum(REPORT_CATEGORIES),
  message: z.string().min(1).max(5000),
  contactEmail: z.string().email().optional(),
  analysisId: z.string().optional(),
});

/** 從 FormData 取出字串欄位；不是字串（例如誤傳成檔案）或空白一律視為未填。 */
function formValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawIp = getClientIp(request);
  const { clientId, isNew } = getOrCreateClientId(request);
  const ip = normalizeIp(rawIp) ?? rawIp;
  await ensureClient(clientId, ip, request.headers.get('user-agent'));

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse('bad_request', '無法解析送出的內容，請確認格式為 multipart/form-data。', 400);
  }

  const parsed = fieldsSchema.safeParse({
    category: formValue(formData, 'category'),
    message: formValue(formData, 'message'),
    contactEmail: formValue(formData, 'contactEmail'),
    analysisId: formValue(formData, 'analysisId'),
  });
  if (!parsed.success) {
    return errorResponse('bad_request', '請求格式不正確，請確認問題類型與描述內容。', 400);
  }

  const { category, message, contactEmail, analysisId } = parsed.data;

  const screenshotEntry = formData.get('screenshot');
  const hasScreenshot = screenshotEntry instanceof File && screenshotEntry.size > 0;

  // 有附截圖才走上傳的防濫用檢查（比照 `POST /api/files`）；純文字回報
  // 維持原本只檢查是否已被封鎖，不因為新增了上傳能力而變嚴格。
  if (hasScreenshot) {
    const guardResult = await checkUploadAllowed({ ip: rawIp, clientId });
    if (!guardResult.allowed) {
      return guardToError(guardResult);
    }
  } else if (await isBlocked(ip)) {
    return errorResponse('blocked', '此來源已被停用。', 403);
  }

  if (contactEmail && (await isEmailBlocked(contactEmail))) {
    return errorResponse('blocked', '此聯絡信箱已被停用，無法送出回報。', 403);
  }

  let screenshotData: Buffer | null = null;
  let screenshotExtension: string | null = null;

  if (hasScreenshot) {
    const file = screenshotEntry as File;
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || 'screenshot';

    const rules = await getSetting('abuse_rules');
    if (buffer.length > rules.maxImageBytes) {
      await recordEvent(ip, 'rejected');
      return errorResponse(
        'file_too_large',
        `截圖大小超過上限（上限 ${formatBytes(rules.maxImageBytes)}）。`,
        400,
      );
    }

    const fileCategory = detectCategory(filename, buffer);
    if (fileCategory !== 'image') {
      await recordEvent(ip, 'rejected');
      return errorResponse('unsupported_file', '截圖僅接受圖片格式。', 400);
    }

    let archive: Awaited<ReturnType<typeof toArchive>>;
    try {
      archive = await toArchive(buffer, filename);
    } catch {
      await recordEvent(ip, 'rejected');
      return errorResponse('unsupported_file', '無法辨識截圖的圖片格式，請改用 JPG 或 PNG。', 400);
    }

    screenshotData = archive.data;
    screenshotExtension = archive.extension;
    await recordEvent(ip, 'upload');
  }

  const [row] = await db
    .insert(schema.reports)
    .values({
      clientId,
      ip,
      category,
      message,
      contactEmail: contactEmail ?? null,
      analysisId: analysisId ?? null,
    })
    .returning({ id: schema.reports.id });

  if (screenshotData && screenshotExtension) {
    const screenshotPath = await saveReportScreenshot(screenshotData, screenshotExtension, row.id);
    await db.update(schema.reports).set({ screenshotPath }).where(eq(schema.reports.id, row.id));
  }

  const body: CreateReportResponse = { reportId: row.id };

  const response = NextResponse.json(body, { status: 200 });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { clientId, isNew } = getOrCreateClientId(request);

  const reportRows = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.clientId, clientId))
    .orderBy(desc(schema.reports.createdAt));

  const items: ReportListItem[] = [];
  for (const report of reportRows) {
    const replyRows = await db
      .select()
      .from(schema.reportReplies)
      .where(eq(schema.reportReplies.reportId, report.id))
      .orderBy(schema.reportReplies.createdAt);

    items.push({
      id: report.id,
      category: report.category,
      message: report.message,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      hasScreenshot: report.screenshotPath !== null,
      replies: replyRows.map((reply) => ({
        body: reply.body,
        createdAt: reply.createdAt.toISOString(),
      })),
    });
  }

  const body: ReportListResponse = { items };

  const response = NextResponse.json(body, { status: 200 });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}
