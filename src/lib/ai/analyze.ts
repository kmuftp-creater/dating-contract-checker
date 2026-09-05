/**
 * 對外入口：串起提示詞組裝、備援鏈執行、JSON 驗證，產出 `AnalysisRun`。
 *
 * 選路邏輯（2026-09-05 重構為可列舉、可觀測的備援鏈，見 `chain.ts`）：
 * 1. 帶圖片的分析一律直接走 CostScale 閘道，完全不碰 Groq——Groq 目前
 *    支援影像的模型單次請求最多只能帶 3 到 5 張圖片，本專案掃描檔 PDF
 *    一次最多可能產生 30 張圖片、手機拍照也可能多張，Groq 視覺模型無法
 *    一次處理，硬送只會失敗。
 * 2. 純文字分析依 `chain.ts` 的 `buildChainLayers` 定義，由上而下嘗試：
 *    `groq_direct`（後台啟用且有金鑰時，金鑰洗牌後逐支嘗試）
 *    → `gateway_primary` → `gateway_fallback`。
 * 3. 每一次嘗試失敗時，依 `chain.ts` 的 `classifyError` 分類決定要跳過
 *    什麼（只跳這一層／跳同上游的層／跳同憑證的層／整條鏈立刻停止），
 *    規則詳見 `chain.ts` 檔頭的 B 段表格，這裡不重複列。
 * 4. 整條鏈有總時間上限（`CHAIN_TOTAL_BUDGET_MS`，預設 60 秒）；某一層
 *    在時間窗內連續失敗達門檻會進入熔斷，熔斷期間直接跳過不嘗試
 *    （見 `chain.ts` 的 `isCircuitOpen`／`recordAttemptResult`）。
 * 5. 每一次實際發出的嘗試（跳過的不算）都會寫一筆 `ai_chain_attempts`
 *    事件（見 `chain-events.ts`），供後台「備援鏈狀態」頁面統計。
 * 6. 全部層都失敗（或超過總時間上限）時，明確拋出中文錯誤，訊息列出
 *    每一層的失敗原因、不含任何金鑰內容——**不會偽造一份「示範」結果**。
 *    這是刻意的產品決定，理由見 `chain.ts` 檔頭「重要的產品決定」。
 *    呼叫端（`src/lib/worker/queue.ts`）既有行為就是把該筆分析標記為
 *    failed 並退還使用者次數，這裡不需要也不應該改。
 *
 * usage 累加原則不變：每一次實際呼叫（不論成功或失敗）只要閘道／Groq
 * 有回應出可辨識的 usage，都會併入總量，不只算最後一次成功的呼叫。
 */

import type { AnalysisRun, ExtractedImage, TokenUsage } from '@/lib/types';
import { getSetting } from '@/lib/settings';

import { annotateCoverage, checkCoverage, extractChecklistIds } from './checklist';
import {
  classifyError,
  isCircuitOpen,
  recordAttemptResult,
  CHAIN_TOTAL_BUDGET_MS,
  LAYER_LABELS,
  LAYER_TIMEOUTS_MS,
  type ChainErrorCategory,
  type ChainLayerId,
} from './chain';
import { recordChainAttempt } from './chain-events';
import { callGateway, callGroq, GatewayCallError, type CallGatewayResult } from './gateway';
import { buildMessages, type ChatMessage, estimateTokens, truncateContract } from './prompt';
import { parseAnalysisResult } from './schema';

export interface AnalyzeGatewayConfig {
  baseUrl: string;
  apiKey: string;
  /** 主要模型別名，例如 gemini-2.5-flash。 */
  primaryModel: string;
  /** 備援模型別名，主要模型呼叫失敗時使用，例如 gemini-flash-paid。 */
  fallbackModel: string;
  clientId: string;
  feature: string;
  /** 覆蓋每一層的預設逾時（見 `chain.ts` 的 `LAYER_TIMEOUTS_MS`）；不帶則各層各用各的預設值。 */
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** 單次分析的輸入 token 上限，預設 200,000（見設計文件第三章第 8 節）。 */
  maxInputTokens?: number;
}

export interface AnalyzeContractInput {
  checklistMarkdown: string;
  regulationMarkdown: string;
  contractText: string;
  contractImages: ExtractedImage[];
  gateway: AnalyzeGatewayConfig;
}

const DEFAULT_MAX_INPUT_TOKENS = 200000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addUsage(total: TokenUsage, delta: TokenUsage): void {
  total.inputTokens += delta.inputTokens;
  total.outputTokens += delta.outputTokens;
}

/** Fisher-Yates 洗牌，回傳新陣列，不修改原本的金鑰清單。 */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 依鏈實際執行的一次嘗試：可能是某一層本身，也可能是該層底下的某支 Groq 金鑰。 */
interface ChainAttempt {
  layerId: ChainLayerId;
  /** 失敗訊息裡用來指出是哪一次嘗試，絕不含金鑰內容。 */
  describe: string;
  /** 跳層規則用：unreachable 會跳過所有 upstreamGroup 相同的嘗試。 */
  upstreamGroup: string;
  /** 跳層規則用：rate_limit 只跳過 credentialGroup 相同的嘗試。 */
  credentialGroup: string;
  execute: () => Promise<CallGatewayResult>;
}

/** 依目前設定與這次分析的輸入，組出依序要嘗試的鏈。 */
function buildAttempts(params: {
  gateway: AnalyzeGatewayConfig;
  messages: ChatMessage[];
  hasImages: boolean;
  groq: { enabled: boolean; keys: string[]; baseUrl: string; model: string };
}): ChainAttempt[] {
  const { gateway, messages, hasImages, groq } = params;
  const attempts: ChainAttempt[] = [];

  // groq_direct：只有純文字分析、後台啟用、且有金鑰時才加入這一層。
  if (!hasImages && groq.enabled && groq.keys.length > 0) {
    const timeoutMs = gateway.timeoutMs ?? LAYER_TIMEOUTS_MS.groq_direct;
    const shuffledKeys = shuffle(groq.keys);
    shuffledKeys.forEach((key, index) => {
      attempts.push({
        layerId: 'groq_direct',
        describe: `Groq 第 ${index + 1} 支金鑰`,
        upstreamGroup: `groq:${groq.baseUrl}`,
        credentialGroup: `groq-key:${key}`,
        execute: () =>
          callGroq({
            baseUrl: groq.baseUrl,
            apiKey: key,
            model: groq.model,
            messages,
            timeoutMs,
            maxOutputTokens: gateway.maxOutputTokens,
          }),
      });
    });
  }

  const primaryTimeoutMs = gateway.timeoutMs ?? LAYER_TIMEOUTS_MS.gateway_primary;
  attempts.push({
    layerId: 'gateway_primary',
    describe: `閘道主要模型（${gateway.primaryModel}）`,
    upstreamGroup: `gateway:${gateway.baseUrl}`,
    credentialGroup: `gateway-key:${gateway.apiKey}`,
    execute: () =>
      callGateway({
        baseUrl: gateway.baseUrl,
        apiKey: gateway.apiKey,
        model: gateway.primaryModel,
        messages,
        clientId: gateway.clientId,
        feature: gateway.feature,
        timeoutMs: primaryTimeoutMs,
        maxOutputTokens: gateway.maxOutputTokens,
      }),
  });

  const fallbackTimeoutMs = gateway.timeoutMs ?? LAYER_TIMEOUTS_MS.gateway_fallback;
  attempts.push({
    layerId: 'gateway_fallback',
    describe: `閘道備援模型（${gateway.fallbackModel}）`,
    upstreamGroup: `gateway:${gateway.baseUrl}`,
    credentialGroup: `gateway-key:${gateway.apiKey}`,
    execute: () =>
      callGateway({
        baseUrl: gateway.baseUrl,
        apiKey: gateway.apiKey,
        model: gateway.fallbackModel,
        messages,
        clientId: gateway.clientId,
        feature: gateway.feature,
        timeoutMs: fallbackTimeoutMs,
        maxOutputTokens: gateway.maxOutputTokens,
      }),
  });

  return attempts;
}

/** 依查核表分析一份合約，回傳結果與累計用量。 */
export async function analyzeContract(input: AnalyzeContractInput): Promise<AnalysisRun> {
  const { gateway } = input;
  const maxInputTokens = gateway.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;

  // 法規內容固定不截斷，只截斷合約文字；預留一部分預算給法規與輸出。
  const fixedTokens =
    estimateTokens(input.checklistMarkdown) + estimateTokens(input.regulationMarkdown);
  const contractBudget = Math.max(maxInputTokens - fixedTokens, 1000);
  const { text: contractText, truncated } = truncateContract(input.contractText, contractBudget);

  const messages = buildMessages({
    checklistMarkdown: input.checklistMarkdown,
    regulationMarkdown: input.regulationMarkdown,
    contractText,
    contractImages: input.contractImages,
  });

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const expectedIds = extractChecklistIds(input.checklistMarkdown);
  const hasImages = input.contractImages.length > 0;

  /** 檢查查核表覆蓋率、補上截斷提示，組出最終要回傳的 `AnalysisRun`。 */
  function finalizeResult(
    rawResult: ReturnType<typeof parseAnalysisResult>,
    modelLabel: string,
  ): AnalysisRun {
    let result = rawResult;
    if (expectedIds.length > 0) {
      result = annotateCoverage(result, checkCoverage(expectedIds, result.items));
    }
    if (truncated) {
      const truncateNote = '合約內容過長，已從中間截斷後送分析，結果可能不完整。';
      result = {
        ...result,
        notes: result.notes ? `${truncateNote} ${result.notes}` : truncateNote,
      };
    }
    return { result, usage, model: modelLabel };
  }

  const groqSettings = hasImages
    ? { enabled: false, keys: [] as string[], baseUrl: '', model: '' }
    : await (async () => {
        const aiSettings = await getSetting('ai');
        return {
          enabled: aiSettings.groqEnabled,
          keys: aiSettings.groqApiKeys,
          baseUrl: aiSettings.groqBaseUrl,
          model: aiSettings.groqModel,
        };
      })();

  const attempts = buildAttempts({ gateway, messages, hasImages, groq: groqSettings });
  const layerGroups = groupAttemptsByLayer(attempts);

  const skipUpstreams = new Set<string>();
  const skipCredentials = new Set<string>();
  const failures: string[] = [];
  const startedAt = Date.now();

  layerLoop: for (const group of layerGroups) {
    // 熔斷檢查放在「這一層」的層級，只查一次：這一層底下若有好幾支 Groq 金鑰，
    // 同一次分析裡逐支嘗試造成的連續失敗不該讓熔斷器在同一次呼叫中途就把
    // 還沒試過的金鑰也擋掉——熔斷要防的是「這一層跨多次分析持續壞掉」，
    // 不是「這一層底下本來就有很多支憑證要輪流試」。
    if (isCircuitOpen(group.layerId)) {
      failures.push(`${group.label}：目前熔斷中（近期連續失敗次數過多），暫不嘗試`);
      continue;
    }

    let layerAttemptedAny = false;

    for (const attempt of group.attempts) {
      if (skipUpstreams.has(attempt.upstreamGroup)) {
        continue;
      }
      if (skipCredentials.has(attempt.credentialGroup)) {
        continue;
      }
      if (Date.now() - startedAt >= CHAIN_TOTAL_BUDGET_MS) {
        failures.push(
          `已超過整條鏈的總時間上限（${Math.round(CHAIN_TOTAL_BUDGET_MS / 1000)} 秒），停止嘗試其餘的層`,
        );
        break layerLoop;
      }

      layerAttemptedAny = true;
      const attemptStartedAt = Date.now();
      let callResult: CallGatewayResult;
      try {
        callResult = await attempt.execute();
      } catch (callError) {
        const latencyMs = Date.now() - attemptStartedAt;
        const category = classifyError(callError);
        if (callError instanceof GatewayCallError && callError.usage) {
          addUsage(usage, callError.usage);
        }
        await recordChainAttempt({
          layerId: attempt.layerId,
          ok: false,
          errorCategory: category,
          latencyMs,
        });
        failures.push(`${attempt.describe}：${errorMessage(callError)}`);
        applySkipRule(category, attempt, skipUpstreams, skipCredentials);
        if (category === 'bad_request') {
          failures.push('請求內容本身有問題（HTTP 400/422），換上游也一樣會失敗，整條鏈立即停止');
          recordAttemptResult(group.layerId, false);
          break layerLoop;
        }
        continue;
      }
      addUsage(usage, callResult.usage);

      // 解析成功的回應是否為合法的查核結果 JSON——這裡失敗也算這一層的失敗
      // （parse_error，只跳過這一層，見 chain.ts 的 B 段規則），不像重構前
      // 只重試同一層一次；換下一層更符合「別在同一個壞掉的地方一直撞」。
      try {
        const parsed = parseAnalysisResult(callResult.content);
        const latencyMs = Date.now() - attemptStartedAt;
        await recordChainAttempt({ layerId: attempt.layerId, ok: true, errorCategory: null, latencyMs });
        recordAttemptResult(group.layerId, true);
        return finalizeResult(parsed, modelLabelFor(attempt.layerId, callResult.model, groqSettings.model));
      } catch (parseError) {
        const latencyMs = Date.now() - attemptStartedAt;
        const category: ChainErrorCategory = 'parse_error';
        await recordChainAttempt({
          layerId: attempt.layerId,
          ok: false,
          errorCategory: category,
          latencyMs,
        });
        failures.push(`${attempt.describe}：${errorMessage(parseError)}`);
        continue;
      }
    }

    // 走到這裡代表這一層底下的嘗試（可能不只一支憑證）全部失敗——成功時
    // 上面已經 return 掉了。只有「這一層底下有任何嘗試」才算這一層一次
    // 失敗、計入熔斷；完全沒被嘗試到（例如整層都被上一層的 unreachable
    // 跳層規則連帶跳過）不算失敗，不影響熔斷狀態。
    if (layerAttemptedAny) {
      recordAttemptResult(group.layerId, false);
    }
  }

  const reasonList =
    failures.length > 0
      ? failures.map((f, i) => `第 ${i + 1} 項：${f}`).join('；')
      : '沒有任何已啟用的層可用（請檢查後台 AI 設定）';
  throw new Error(`AI 分析失敗：整條備援鏈的每一層都無法取得可用結果。${reasonList}`);
}

interface ChainAttemptGroup {
  layerId: ChainLayerId;
  label: string;
  attempts: ChainAttempt[];
}

/** 把依序排列的嘗試清單，依連續相同的 layerId 分組（每一層在鏈裡只出現一段連續區間）。 */
function groupAttemptsByLayer(attempts: ChainAttempt[]): ChainAttemptGroup[] {
  const groups: ChainAttemptGroup[] = [];
  for (const attempt of attempts) {
    const last = groups[groups.length - 1];
    if (last && last.layerId === attempt.layerId) {
      last.attempts.push(attempt);
    } else {
      groups.push({ layerId: attempt.layerId, label: LAYER_LABELS[attempt.layerId], attempts: [attempt] });
    }
  }
  return groups;
}

/** 依失敗分類套用跳層規則，直接改動傳入的兩個 Set（規格書 B 段）。 */
function applySkipRule(
  category: ChainErrorCategory,
  attempt: ChainAttempt,
  skipUpstreams: Set<string>,
  skipCredentials: Set<string>,
): void {
  if (category === 'unreachable') {
    skipUpstreams.add(attempt.upstreamGroup);
  } else if (category === 'rate_limit') {
    skipCredentials.add(attempt.credentialGroup);
  }
  // timeout、server_error、parse_error：只跳過這一層，迴圈本身的 continue 就是「跳過」，
  // 不需要額外標記。bad_request 由呼叫端另外中止整條鏈。
}

/** 成功時要記錄／回傳的模型標籤：groq_direct 用設定的模型別名，閘道層用回應echo回來的模型名。 */
function modelLabelFor(layerId: ChainLayerId, responseModel: string, groqModel: string): string {
  return layerId === 'groq_direct' ? `groq:${groqModel}` : responseModel;
}
