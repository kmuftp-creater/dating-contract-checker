import 'server-only';

import { analyzeContract } from '@/lib/ai/analyze';
import {
  type AnalysisRow,
  claimNext,
  listFiles,
  markDone,
  markFailed,
} from '@/lib/analyses';
import { getVersion } from '@/lib/documents';
import { onAnalysisCompleted } from '@/lib/email/hooks';
import { refundQuota, type QuotaSubject } from '@/lib/guard/quota';
import { getSetting } from '@/lib/settings';
import { readContractImages } from '@/lib/storage';
import type { ExtractedImage } from '@/lib/types';

/**
 * 背景處理佇列。
 *
 * `analyses` 表本身就是佇列，這裡用固定間隔輪詢 `claimNext()`（內部用
 * `SELECT ... FOR UPDATE SKIP LOCKED`），同時處理的筆數依設計文件第五章
 * 「假設為 3」。目前 `abuse_rules`、`retention` 等設定組都沒有對應欄位，
 * 因此先用常數，之後要開放後台調整時再補一組設定。
 */
const CONCURRENCY = 3;
const POLL_INTERVAL_MS = 1500;

let activeCount = 0;
let stopping = false;
let timer: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 處理單一筆已被 `claimNext` 取走（狀態為 `running`）的分析：
 * 讀檔案暫存內容 → 組出合約文字與圖片 → 讀 AI 設定 → 呼叫 `analyzeContract`
 * → 寫回結果。任何一步失敗都標記失敗並退還這筆分析佔用的次數
 * （見設計文件第二章第 4 節：分析失敗不應扣次數）。
 */
async function processAnalysis(row: AnalysisRow): Promise<void> {
  const files = await listFiles(row.id);
  const subjects: QuotaSubject[] = [
    { type: 'client', value: row.clientId },
    { type: 'ip', value: row.ip },
  ];
  // 這筆分析建立當時，扣掉的次數等於它所附的檔案數（貼上的文字也算一個
  // 檔案，已經在建檔時寫成一列 analysisFiles），所以退款用同一個數字。
  const refundCount = Math.max(files.length, 1);

  try {
    const aiSettings = await getSetting('ai');
    if (!aiSettings.gatewayUrl || !aiSettings.apiKey) {
      await markFailed(row.id, '尚未設定 AI 閘道，請聯絡系統管理員完成設定後再試。');
      await refundQuota(subjects, refundCount);
      return;
    }

    if (!row.checklistVersionId || !row.regulationVersionId) {
      await markFailed(row.id, '這筆分析當時未能取得生效中的法規文件版本，請重新建立分析。');
      await refundQuota(subjects, refundCount);
      return;
    }

    const [checklistDoc, regulationDoc] = await Promise.all([
      getVersion(row.checklistVersionId),
      getVersion(row.regulationVersionId),
    ]);

    if (!checklistDoc || !regulationDoc) {
      await markFailed(row.id, '找不到這筆分析當時依據的法規文件版本，可能已被刪除。');
      await refundQuota(subjects, refundCount);
      return;
    }

    const textParts: string[] = [];
    const images: ExtractedImage[] = [];
    for (const file of files) {
      if (file.extractedText) {
        textParts.push(`【檔案：${file.originalName}】\n${file.extractedText}`);
      }
      if (file.extractMethod === 'ocr' && file.storagePath) {
        images.push(...(await readContractImages(file.storagePath)));
      }
    }

    const run = await analyzeContract({
      checklistMarkdown: checklistDoc.markdown,
      regulationMarkdown: regulationDoc.markdown,
      contractText: textParts.join('\n\n'),
      contractImages: images,
      gateway: {
        baseUrl: aiSettings.gatewayUrl,
        apiKey: aiSettings.apiKey,
        primaryModel: aiSettings.primaryModel,
        fallbackModel: aiSettings.fallbackModel,
        clientId: aiSettings.costClientId,
        feature: 'analyze',
        maxInputTokens: aiSettings.maxInputTokens,
      },
    });

    await markDone(row.id, run.result, run.usage, run.model);

    // 分析成功完成後才觸發後續處理；失敗的分析（上面各個 markFailed
    // 分支）不觸發。後續處理失敗不該讓這筆已經完成的分析被標記失敗，
    // 所以只記錄，不拋出。
    try {
      await onAnalysisCompleted(row.id);
    } catch (error) {
      console.error(`[worker] 分析 ${row.id} 的後續處理失敗：${errorMessage(error)}`);
    }
  } catch (error) {
    await markFailed(row.id, `分析處理失敗：${errorMessage(error)}`);
    await refundQuota(subjects, refundCount);
  }
}

/** 一輪輪詢：在還有並行名額時持續取件並丟出去處理，取不到就停手等下一輪。 */
async function tick(): Promise<void> {
  if (stopping) {
    return;
  }

  while (!stopping && activeCount < CONCURRENCY) {
    let claimed: AnalysisRow | null;
    try {
      claimed = await claimNext();
    } catch (error) {
      console.error(`[worker] 取件時發生錯誤：${errorMessage(error)}`);
      break;
    }

    if (!claimed) {
      break;
    }

    activeCount += 1;
    void processAnalysis(claimed)
      .catch((error) => {
        console.error(`[worker] 處理分析 ${claimed.id} 時發生未預期錯誤：${errorMessage(error)}`);
      })
      .finally(() => {
        activeCount -= 1;
      });
  }
}

/** 啟動輪詢。重複呼叫是安全的，已啟動時不會重複建立計時器。 */
export function startQueue(): void {
  if (timer) {
    return;
  }
  stopping = false;
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  void tick();
}

/** 停止輪詢並等待所有進行中的工作結束，供優雅關機使用。 */
export async function stopQueue(): Promise<void> {
  stopping = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  while (activeCount > 0) {
    await sleep(100);
  }
}
