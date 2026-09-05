/**
 * AI 備援鏈的定義、錯誤分類、跳層規則與熔斷器。
 *
 * 對應 2026-09-05 需求「AI 設定要有備援功能」。這個檔案只放「鏈長什麼樣」
 * 與「失敗時怎麼判斷、跳過誰」這兩件事，實際依鏈執行嘗試、把結果組回
 * `AnalysisRun` 的邏輯在 `analyze.ts`；把每次嘗試寫進資料庫、查 30 天
 * 統計的邏輯在 `chain-events.ts`。
 *
 * ---------------------------------------------------------------------------
 * 重要的產品決定（見規格書 F 段）：最後一層失敗時不偽造結果。
 * ---------------------------------------------------------------------------
 * 本專案是法規檢核工具，使用者看到的是「這份合約哪裡不合規」。如果鏈的
 * 最後一層改成回傳內建的示範內容（像某些聊天產品在全部上游失敗時退回的
 * 「示範模式」），使用者會拿到一份看起來正常、實際上是憑空捏造的合規
 * 報告——這比直接告訴使用者「現在分析不了」危險得多：使用者可能依據
 * 一份假報告去簽一份不合規的合約。
 *
 * 因此這條鏈刻意「到底」：`buildChainLayers` 只回三層，全部失敗時
 * `analyze.ts` 一律拋出明確錯誤，呼叫端（`src/lib/worker/queue.ts`）
 * 既有行為就是把該筆分析標記為 failed 並退還使用者次數。這個決定不會
 * 因為之後想「體驗更好」而加一層假資料的備援——需要更高可用性時，該做
 * 的是修前面壞掉的層，不是在鏈尾加一層謊言。
 */

import type { AiSettings } from '@/lib/settings';

import { GatewayCallError } from './gateway';

// ---------------------------------------------------------------------------
// 鏈的定義（規格書 A 段）
// ---------------------------------------------------------------------------

export type ChainTransport = 'direct' | 'gateway';

export const CHAIN_LAYER_IDS = ['groq_direct', 'gateway_primary', 'gateway_fallback'] as const;
export type ChainLayerId = (typeof CHAIN_LAYER_IDS)[number];

/** 各層的預設逾時：主路徑給比較長，備援層給短，避免整體等待時間失控。 */
export const LAYER_TIMEOUTS_MS: Record<ChainLayerId, number> = {
  groq_direct: 20_000,
  gateway_primary: 20_000,
  gateway_fallback: 15_000,
};

/** 整條鏈的總時間上限，超過就停止嘗試並回報失敗（規格書 A 段）。 */
export const CHAIN_TOTAL_BUDGET_MS = 60_000;

/** 各層的中文顯示名稱，`buildChainLayers` 與 `analyze.ts` 共用同一份，避免兩邊文字兜不起來。 */
export const LAYER_LABELS: Record<ChainLayerId, string> = {
  groq_direct: 'Groq 直連（金鑰輪替）',
  gateway_primary: 'CostScale 閘道·主要模型',
  gateway_fallback: 'CostScale 閘道·備援模型',
};

/** 一層在這個時間窗內連續失敗達門檻即熔斷（規格書 C 段）。 */
export const CIRCUIT_BREAKER_THRESHOLD = 3;
export const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
export const CIRCUIT_BREAKER_OPEN_MS = 60_000;

export interface ChainLayerDef {
  id: ChainLayerId;
  label: string;
  transport: ChainTransport;
  upstream: string;
  model: string;
  timeoutMs: number;
  supportsImages: boolean;
  enabled: boolean;
  /** 停用原因；已啟用時為空字串。 */
  disabledReason: string;
  /** 這一層存在的理由與它擋掉什麼，供後台顯示（規格書 E 段）。 */
  purpose: string;
}

/**
 * 依目前的 AI 設定組出鏈的靜態定義，給後台「備援鏈狀態」表格顯示用。
 *
 * 這裡的 `upstream`／`model` 只反映後台設定值，供人閱讀；實際執行一次
 * 分析時，閘道層（`gateway_primary`、`gateway_fallback`）用的是呼叫端
 * 傳入 `analyzeContract` 的 `gateway` 設定（見 `analyze.ts`），兩者在
 * 正式環境下同一份設定，只有驗證腳本會刻意指向假伺服器測試。
 */
export function buildChainLayers(ai: AiSettings): ChainLayerDef[] {
  const groqConfigured = ai.groqApiKeys.length > 0;
  const groqReady = ai.groqEnabled && groqConfigured;
  const gatewayConfigured = ai.gatewayUrl !== '' && ai.apiKey !== '';

  return [
    {
      id: 'groq_direct',
      label: LAYER_LABELS.groq_direct,
      transport: 'direct',
      upstream: 'Groq',
      model: ai.groqModel,
      timeoutMs: LAYER_TIMEOUTS_MS.groq_direct,
      supportsImages: false,
      enabled: groqReady,
      disabledReason: groqReady
        ? ''
        : !ai.groqEnabled
          ? '後台尚未啟用 Groq 金鑰輪替'
          : '尚未設定任何 Groq 金鑰',
      purpose:
        '純文字分析時第一層嘗試，成本與延遲通常較低。**有文字層的 PDF、Word、Excel 也走這一層**：' +
        '系統先把文字抽出來再送 AI，送出去的是文字而不是檔案，所以這些格式與純文字檔沒有差別。' +
        '真正跳過這一層的只有「必須用看的」的內容——照片，以及沒有文字層、只能整頁轉成圖片的掃描檔。' +
        'Groq 的視覺模型單次最多只能帶 3 到 5 張圖片（2026-09-05 查證於官方文件），' +
        '本專案掃描檔可能一次多達 30 頁，硬送只會失敗，因此帶圖片的分析完全跳過這一層。' +
        '閘道（下面兩層）整個不通時，這一層完全不受影響，仍可服務純文字分析。',
    },
    {
      id: 'gateway_primary',
      label: LAYER_LABELS.gateway_primary,
      transport: 'gateway',
      upstream: 'CostScale 閘道',
      model: ai.primaryModel,
      timeoutMs: LAYER_TIMEOUTS_MS.gateway_primary,
      supportsImages: true,
      enabled: gatewayConfigured,
      disabledReason: gatewayConfigured ? '' : '尚未設定閘道網址或虛擬金鑰',
      purpose:
        '所有帶圖片的分析、以及 Groq 未啟用或 Groq 全部金鑰都失敗的純文字分析，都會送到這一層。' +
        '閘道網址本身若整個不通（DNS 失敗、401/403/404），會連帶跳過下面的備援模型層——' +
        '兩層打的是同一個閘道位址，各試一次沒有意義。',
    },
    {
      id: 'gateway_fallback',
      label: LAYER_LABELS.gateway_fallback,
      transport: 'gateway',
      upstream: 'CostScale 閘道',
      model: ai.fallbackModel,
      timeoutMs: LAYER_TIMEOUTS_MS.gateway_fallback,
      supportsImages: true,
      enabled: gatewayConfigured,
      disabledReason: gatewayConfigured ? '' : '尚未設定閘道網址或虛擬金鑰',
      purpose:
        '主要模型逾時或伺服器錯誤等單次性問題時的最後一層。這一層若在近 30 天內有成功紀錄，' +
        '代表它前面的每一層都失敗過至少一次——見上方「要處理的事」。全部層都失敗時不會有更後面' +
        '的示範或捏造結果層，系統會明確回報分析失敗（見本檔頂端「重要的產品決定」）。',
    },
  ];
}

// ---------------------------------------------------------------------------
// 錯誤分類與跳層規則（規格書 B 段）
// ---------------------------------------------------------------------------

export type ChainErrorCategory =
  | 'unreachable'
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'bad_request'
  | 'parse_error';

export const CHAIN_ERROR_CATEGORIES: ChainErrorCategory[] = [
  'unreachable',
  'rate_limit',
  'timeout',
  'server_error',
  'bad_request',
  'parse_error',
];

/** 各分類的中文說明與跳層行為，後台頁面直接引用這份文字，兩邊不會兜不起來。 */
export const CHAIN_ERROR_CATEGORY_INFO: Record<
  ChainErrorCategory,
  { label: string; judgedBy: string; behavior: string }
> = {
  unreachable: {
    label: '連不上上游',
    judgedBy: '連線失敗、DNS 失敗、HTTP 401、403、404',
    behavior: '跳過所有共用同一個上游位址的層——它們一起壞，逐層再試只是浪費時間。',
  },
  rate_limit: {
    label: '被上游限流',
    judgedBy: 'HTTP 429',
    behavior: '只跳過共用同一組憑證的層（Groq 每一支金鑰視為不同憑證）。',
  },
  timeout: {
    label: '逾時',
    judgedBy: '這一層在設定的逾時內沒有回應',
    behavior: '只跳過這一層。逾時只代表這次慢，不代表上游壞了。',
  },
  server_error: {
    label: '上游伺服器錯誤',
    judgedBy: 'HTTP 5xx',
    behavior: '只跳過這一層。',
  },
  bad_request: {
    label: '請求內容有問題',
    judgedBy: 'HTTP 400、422',
    behavior: '整條鏈立刻停止，不再往下試——換上游也一樣會失敗，繼續試只是浪費金錢並掩蓋自己的 bug。',
  },
  parse_error: {
    label: '回應解析失敗',
    judgedBy: '回應不是合法 JSON（或不是預期的查核結果結構）',
    behavior: '只跳過這一層。',
  },
};

/**
 * 把一次失敗歸類成六種分類之一。
 *
 * 優先讀 `GatewayCallError` 帶的結構化 `status`／`kind`（見 `gateway.ts`）；
 * 不是這個型別時（例如 `parseAnalysisResult` 拋出的查核結果解析錯誤），
 * 退回用中文錯誤訊息的關鍵字判斷。判斷不出來的一律當作 `server_error`
 * （只跳過這一層），避免誤判成 `unreachable` 而錯殺其他其實還能用的層。
 */
export function classifyError(error: unknown): ChainErrorCategory {
  if (error instanceof GatewayCallError) {
    if (error.kind === 'timeout') {
      return 'timeout';
    }
    if (error.kind === 'network') {
      return 'unreachable';
    }
    if (error.kind === 'invalid_json') {
      return 'parse_error';
    }
    if (typeof error.status === 'number') {
      const status = error.status;
      if (status === 401 || status === 403 || status === 404) {
        return 'unreachable';
      }
      if (status === 429) {
        return 'rate_limit';
      }
      if (status === 400 || status === 422) {
        return 'bad_request';
      }
      if (status >= 500) {
        return 'server_error';
      }
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('無法解析為 JSON') || message.includes('缺少必要欄位')) {
    return 'parse_error';
  }
  if (message.includes('逾時')) {
    return 'timeout';
  }
  if (message.includes('連線失敗')) {
    return 'unreachable';
  }
  return 'server_error';
}

// ---------------------------------------------------------------------------
// 熔斷器（規格書 C 段）：行程記憶體即可，不持久化，重啟後清空。
// ---------------------------------------------------------------------------

interface BreakerState {
  /** 目前這波「連續失敗」在時間窗內的時間戳記。 */
  failureTimestamps: number[];
  /** 熔斷解除時間；null 代表目前沒有熔斷。 */
  openUntil: number | null;
}

const breakerState = new Map<ChainLayerId, BreakerState>();

/** 這一層目前是否處於熔斷中；順便清掉已經到期的熔斷狀態。 */
export function isCircuitOpen(layerId: ChainLayerId, now: number = Date.now()): boolean {
  const state = breakerState.get(layerId);
  if (!state || state.openUntil === null) {
    return false;
  }
  if (now >= state.openUntil) {
    state.openUntil = null;
    state.failureTimestamps = [];
    return false;
  }
  return true;
}

/**
 * 記錄一次嘗試的結果，更新熔斷狀態。
 *
 * 成功會清空連續失敗計數（「連續」失敗才會觸發熔斷，中間穿插一次成功
 * 就重新算）；失敗則把時間戳記加進時間窗內的清單，達門檻就熔斷
 * `CIRCUIT_BREAKER_OPEN_MS` 毫秒。
 */
export function recordAttemptResult(
  layerId: ChainLayerId,
  ok: boolean,
  now: number = Date.now(),
): void {
  const state = breakerState.get(layerId) ?? { failureTimestamps: [], openUntil: null };
  if (ok) {
    state.failureTimestamps = [];
    state.openUntil = null;
  } else {
    state.failureTimestamps = state.failureTimestamps.filter(
      (timestamp) => now - timestamp < CIRCUIT_BREAKER_WINDOW_MS,
    );
    state.failureTimestamps.push(now);
    if (state.failureTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
      state.openUntil = now + CIRCUIT_BREAKER_OPEN_MS;
    }
  }
  breakerState.set(layerId, state);
}

/** 清空全部熔斷狀態，供驗證腳本在每個情境開始前重設用。 */
export function resetCircuitBreakers(): void {
  breakerState.clear();
}
