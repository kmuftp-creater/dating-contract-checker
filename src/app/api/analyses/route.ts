import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  createAnalysis,
  getTodayTokenTotal,
  listForClient,
  type AnalysisFilePlan,
} from '@/lib/analyses';
import type {
  AnalysisListItem,
  AnalysisListResponse,
  CreateAnalysisResponse,
} from '@/lib/api-contract';
import { checkRelevance } from '@/lib/ai/relevance';
import { getPublishedPair } from '@/lib/documents';
import { checkAnalyzeAllowed } from '@/lib/guard';
import { ensureClient } from '@/lib/guard/client';
import { normalizeIp } from '@/lib/guard/ip';
import { buildOffTopicMessage, recordOffTopic } from '@/lib/guard/off-topic';
import { getRemaining, refundQuota, type QuotaSubject } from '@/lib/guard/quota';
import { recordEvent } from '@/lib/guard/window';
import { errorResponse, getClientIp, getOrCreateClientId, guardToError, setClientCookie,
  getClientCountry,
} from '@/lib/http';
import { getSetting } from '@/lib/settings';
import { deletePending, readPending } from '@/lib/storage';

/**
 * `POST /api/analyses`：以先前上傳的檔案 id 清單或貼上的文字建立分析。
 * `GET /api/analyses`：查自己（依瀏覽器識別碼）的歷史紀錄。
 */

const createBodySchema = z.object({
  fileIds: z.array(z.string()).default([]),
  pastedText: z.string().optional(),
  mode: z.enum(['merged', 'separate']),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawIp = getClientIp(request);
  const country = getClientCountry(request);
  const { clientId, isNew } = getOrCreateClientId(request);
  const ip = normalizeIp(rawIp) ?? rawIp;
  await ensureClient(clientId, ip, request.headers.get('user-agent'));

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return errorResponse('bad_request', '請求內容不是合法的 JSON。', 400);
  }

  const parsed = createBodySchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse('bad_request', '請求格式不正確，缺少 mode 或欄位型別錯誤。', 400);
  }

  const { fileIds, mode } = parsed.data;
  const pastedText = parsed.data.pastedText?.trim() ?? '';

  const rules = await getSetting('abuse_rules');

  if (fileIds.length > rules.maxFilesPerBatch) {
    return errorResponse(
      'too_many_files',
      `一次最多只能上傳 ${rules.maxFilesPerBatch} 個檔案。`,
      400,
    );
  }

  if (pastedText.length > rules.maxPastedTextChars) {
    return errorResponse(
      'bad_request',
      `貼上的文字長度超過上限（上限 ${rules.maxPastedTextChars} 字）。`,
      400,
    );
  }

  if (fileIds.length === 0 && pastedText.length === 0) {
    return errorResponse('bad_request', '請至少上傳一個檔案或貼上文字。', 400);
  }

  const pendingList = await Promise.all(fileIds.map((fileId) => readPending(fileId)));
  const missingIndex = pendingList.findIndex((item) => item === null);
  if (missingIndex !== -1) {
    return errorResponse('bad_request', '找不到指定的檔案，可能已逾期或尚未上傳成功，請重新上傳。', 400);
  }

  const { checklist, regulation } = await getPublishedPair();
  if (!checklist || !regulation) {
    return errorResponse('bad_request', '系統尚未設定生效中的法規文件，請聯絡管理員。', 400);
  }

  const fileCount = fileIds.length + (pastedText.length > 0 ? 1 : 0);

  const guardResult = await checkAnalyzeAllowed({ ip: rawIp, clientId, fileCount }, getTodayTokenTotal);
  if (!guardResult.allowed) {
    return guardToError(guardResult);
  }

  const filePlans: AnalysisFilePlan[] = pendingList.map((bundle) => {
    const pending = bundle!;
    return {
      originalName: pending.meta.originalName,
      mime: pending.meta.mime,
      size: pending.meta.size,
      extractMethod: pending.meta.extractMethod,
      pageCount: pending.meta.pageCount,
      text: pending.text,
      images: pending.images,
      archive: pending.archive,
    };
  });

  if (pastedText.length > 0) {
    filePlans.push({
      originalName: '貼上的文字',
      mime: 'text/plain',
      size: Buffer.byteLength(pastedText, 'utf8'),
      extractMethod: 'text',
      pageCount: 1,
      text: pastedText,
      images: [],
      archive: null,
    });
  }

  // 偵測是否為交友媒合服務契約以外的文件（2026-09-05 需求）。
  //
  // 位置刻意放在這裡：`checkAnalyzeAllowed` 已經扣過配額（見上方），
  // 判定為非目標文件時要把這次扣掉的次數退還——使用者傳錯東西不該被
  // 扣次數；同時這裡還沒有呼叫 `createAnalysis`，判定為非目標文件時
  // 完全不會建立這筆分析，也就不會進到背景佇列白白燒一次 AI 分析費用。
  if (rules.offTopicRuleEnabled) {
    const aiSettings = await getSetting('ai');
    const combinedText = filePlans.map((plan) => plan.text).join('\n\n');
    const combinedImages = filePlans.flatMap((plan) => plan.images);

    const relevance = await checkRelevance({
      contractText: combinedText,
      contractImages: combinedImages,
      gateway: {
        baseUrl: aiSettings.gatewayUrl,
        apiKey: aiSettings.apiKey,
        model: aiSettings.primaryModel,
        clientId: aiSettings.costClientId,
        feature: 'relevance_check',
      },
    });

    // 只有明確判定「不是」且把握程度「高」時才擋下；其餘一律放行
    // （見規格書「最重要的設計前提」：不確定時寧可多花一次分析費用，
    // 也不要誤擋真正要用的人）。
    if (!relevance.isTargetContract && relevance.confidence === 'high') {
      const offTopicSubjects: QuotaSubject[] = [
        { type: 'client', value: clientId },
        { type: 'ip', value: ip },
      ];
      await refundQuota(offTopicSubjects, fileCount);

      const outcome = await recordOffTopic(ip);
      const message = buildOffTopicMessage(relevance.documentType, outcome, rules);
      const retryAfterSeconds =
        outcome.action === 'suspend' ? rules.suspendDurationSeconds : undefined;

      const response = errorResponse('off_topic_document', message, 422, retryAfterSeconds);
      if (isNew) {
        setClientCookie(response, clientId);
      }
      return response;
    }

    // 內容確實與交友媒合有關，但只有附件、沒有契約正本。
    //
    // 這種情況不算濫用，是使用者少傳了檔案，所以**不累計非目標文件次數**，
    // 只退還配額並說明要補什麼。硬跑下去會產出一整排假的「不符合」——
    // 查核表的應記載事項幾乎都寫在正本裡，附件本來就不會有。
    // 那份報告看起來像結論，卻是錯的，比不給報告更糟。
    if (relevance.isTargetContract && !relevance.hasMainContract && relevance.confidence === 'high') {
      await refundQuota(
        [
          { type: 'client', value: clientId },
          { type: 'ip', value: ip },
        ],
        fileCount,
      );

      const label = relevance.documentType.trim() || '附件或確認書';
      const response = errorResponse(
        'missing_main_contract',
        `這次只收到「${label}」，沒有交友媒合服務契約的正本。` +
          '查核表的應記載事項大多寫在正本裡，只用附件比對會得到一整排並不成立的「不符合」，' +
          '所以這次不進行分析，也沒有計入您的每日次數。' +
          '請把契約正本與所有附件一次選取後再送出，分析模式維持「合併為一份合約」。' +
          '若您手上真的只有這一份文件，請改用「問題回報」告訴我們，我們會協助確認。',
        422,
      );
      if (isNew) {
        setClientCookie(response, clientId);
      }
      return response;
    }
  }

  const analysisIds: string[] = [];
  if (mode === 'merged') {
    const id = await createAnalysis({
      clientId,
      ip,
      country,
      mode,
      files: filePlans,
      checklistVersionId: checklist.id,
      regulationVersionId: regulation.id,
    });
    analysisIds.push(id);
  } else {
    for (const plan of filePlans) {
      const id = await createAnalysis({
        clientId,
        ip,
        mode,
        files: [plan],
        checklistVersionId: checklist.id,
        regulationVersionId: regulation.id,
      });
      analysisIds.push(id);
    }
  }

  await Promise.all(fileIds.map((fileId) => deletePending(fileId)));
  await recordEvent(ip, 'analyze');

  const subjects: QuotaSubject[] = [
    { type: 'client', value: clientId },
    { type: 'ip', value: ip },
  ];
  const states = await getRemaining(subjects);
  const remaining = states.length > 0 ? Math.min(...states.map((state) => state.remaining)) : 0;

  const body: CreateAnalysisResponse = {
    analysisIds,
    consumed: fileCount,
    remaining,
  };

  const response = NextResponse.json(body, { status: 200 });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}

const DEFAULT_LIST_LIMIT = 20;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { clientId, isNew } = getOrCreateClientId(request);

  const cursor = request.nextUrl.searchParams.get('cursor');
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 0, 1), 100) : DEFAULT_LIST_LIMIT;

  const { items, nextCursor } = await listForClient(clientId, cursor, limit);

  const body: AnalysisListResponse = {
    items: items.map(
      ({ row, fileNames }): AnalysisListItem => ({
        id: row.id,
        status: row.status,
        mode: row.mode,
        createdAt: row.createdAt.toISOString(),
        fileNames,
        summary: row.status === 'done' && row.resultJson ? row.resultJson.summary : null,
      }),
    ),
    nextCursor,
  };

  const response = NextResponse.json(body, { status: 200 });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}
