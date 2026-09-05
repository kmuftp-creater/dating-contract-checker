import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { db, schema } from '@/db';
import type { QuotaResponse } from '@/lib/api-contract';
import { isBlocked, normalizeIp } from '@/lib/guard/ip';
import { getRemaining, type QuotaSubject } from '@/lib/guard/quota';
import { getClientIp, getOrCreateClientId, setClientCookie } from '@/lib/http';
import { getSetting } from '@/lib/settings';

/**
 * `GET /api/quota`：今日剩餘次數與暫停狀態，純讀取，不消耗任何計次或
 * 觸發任何滑動視窗事件。
 *
 * 暫停狀態的判斷邏輯與 `src/lib/guard/index.ts` 的
 * `checkExistingBlockOrSuspension`／`buildSuspendedMessage` 相同，
 * 但那兩個是模組內部函式沒有匯出，這裡照樣的規則另外寫一份唯讀版本，
 * 不呼叫 `checkUploadAllowed`／`checkAnalyzeAllowed`（那兩個有寫入的
 * 副作用，例如記錄事件、扣次數，不適合被單純的查詢頁面呼叫）。
 */
function formatTaipeiTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawIp = getClientIp(request);
  const { clientId, isNew } = getOrCreateClientId(request);
  const ip = normalizeIp(rawIp) ?? rawIp;

  const rules = await getSetting('abuse_rules');

  let suspended = false;
  let retryAfterSeconds: number | null = null;
  let message: string | null = null;

  if (await isBlocked(ip)) {
    suspended = true;
    message = '此來源已被停用。';
  } else {
    const rows = await db
      .select()
      .from(schema.ipStatus)
      .where(eq(schema.ipStatus.ip, ip))
      .limit(1);
    const status = rows[0];

    if (status?.status === 'blocked') {
      suspended = true;
      message = '此來源已被停用。';
    } else if (
      status?.status === 'suspended' &&
      status.suspendedUntil &&
      status.suspendedUntil.getTime() > Date.now()
    ) {
      suspended = true;
      retryAfterSeconds = Math.max(
        Math.ceil((status.suspendedUntil.getTime() - Date.now()) / 1000),
        1,
      );
      const minutes = Math.round(rules.suspendDurationSeconds / 60);
      message =
        `您短時間大量操作，疑似可疑行為，已暫停使用 ${minutes} 分鐘。` +
        `可於 ${formatTaipeiTime(status.suspendedUntil)} 後再試。`;
    }
  }

  const subjects: QuotaSubject[] = [
    { type: 'client', value: clientId },
    { type: 'ip', value: ip },
  ];
  const states = await getRemaining(subjects);
  const used = states.length > 0 ? Math.max(...states.map((state) => state.usedCount)) : 0;
  const limit = rules.dailyAnalysisLimit;
  const remaining = Math.max(limit - used, 0);

  if (!suspended && remaining === 0) {
    message = '今日分析次數已用完，請於明天 00:00（台北時間）後再試。';
  }

  const body: QuotaResponse = {
    used,
    limit,
    remaining,
    suspended,
    retryAfterSeconds,
    message,
    maxFilesPerBatch: rules.maxFilesPerBatch,
    maxImageBytes: rules.maxImageBytes,
    maxDocumentBytes: rules.maxDocumentBytes,
    maxPastedTextChars: rules.maxPastedTextChars,
  };

  const response = NextResponse.json(body, { status: 200 });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}
