'use server';

import { revalidatePath } from 'next/cache';

import { writeAudit } from '@/lib/admin/moderation';
import { callGateway, callGroq, testConnection, testGroqKeys } from '@/lib/ai/gateway';
import { getChainStatus, type ChainStatusView } from '@/lib/ai/chain-status';
import { getEgressIp } from '@/lib/ai/diagnostics';
import { requireAdmin } from '@/auth';
import { runAction } from '@/lib/action-result';
import type { ActionResult } from '@/lib/action-result';
import {
  getSetting,
  updateSetting,
  type AbuseRulesSettings,
  type RetentionSettings,
} from '@/lib/settings';

import {
  buildGatewayPatch,
  buildGroqPatch,
  keyTail,
  parseGroqKeysText,
  toGatewayView,
  toGroqView,
  type GatewayProviderView,
  type GroqProviderView,
} from '../settings/ai/view';

/**
 * 「AI 設定」頁的伺服器動作：CostScale 閘道（Gemini）與 Groq 兩家供應商
 * 的設定、讀取模型清單、測試真實生成、執行診斷，另外還有濫用規則與
 * 保留期兩組不相關的設定。
 *
 * 金鑰只回尾碼（例如「4f2a」）給用戶端，絕不回傳完整明文；輸入框留空
 * 一律表示「不修改已保存的金鑰」（見 admin-ai-service-console 技能規格）。
 *
 * ## 保存類動作為什麼回傳 ActionResult
 *
 * Next.js 在正式環境會把伺服器動作拋出的錯誤訊息遮蔽掉，用戶端只收到
 * 一個泛用錯誤，畫面上就變成「Minified React error #...」。所以管理員
 * 輸入有問題（token 上限填了 0、金鑰格式不對）這類**預期內的錯誤**
 * 一律用回傳值傳遞，見 `@/lib/action-result`。
 *
 * 讀取與測試類動作（`fetch*Models`、`test*Generation`、`diagnose*`）
 * 本來就自帶 `ok`／`error` 欄位，不需要再包一層。
 */
export type { ActionResult };

async function assertAdminEmail(): Promise<string> {
  const user = await requireAdmin();
  if (!user?.email) {
    throw new Error('未登入或不在白名單內，無法執行此操作。');
  }
  return user.email;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// CostScale 閘道卡片
// ---------------------------------------------------------------------------

export interface UpdateGatewaySettingsInput {
  gatewayUrl: string;
  /** 空字串表示不修改已保存的金鑰。 */
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
  maxInputTokens: number;
  costClientId: string;
}

/** 保存 CostScale 閘道設定；有效的網址與金鑰一保存即在備援鏈中生效。 */
export async function updateGatewaySettingsAction(
  input: UpdateGatewaySettingsInput,
): Promise<ActionResult<GatewayProviderView>> {
  return runAction(async () => {
    const adminEmail = await assertAdminEmail();

    if (!Number.isInteger(input.maxInputTokens) || input.maxInputTokens <= 0) {
      throw new Error('每次分析的 token 上限必須是正整數。');
    }

    const patch = buildGatewayPatch(input);
    const updated = await updateSetting('ai', patch);
    await writeAudit(adminEmail, 'settings_update_ai_gateway', 'ai');
    revalidatePath('/admincenter/settings/ai');
    return toGatewayView(updated);
  });
}

// ---------------------------------------------------------------------------
// Groq 卡片
// ---------------------------------------------------------------------------

export interface UpdateGroqSettingsInput {
  enabled: boolean;
  /** 多行文字，一行一支金鑰；空字串表示不修改已保存的金鑰清單，填了就整批取代。 */
  apiKeysText: string;
  baseUrl: string;
  model: string;
}

/** 保存 Groq 設定；`enabled` 就是「啟用中」的判定依據。 */
export async function updateGroqSettingsAction(
  input: UpdateGroqSettingsInput,
): Promise<ActionResult<GroqProviderView>> {
  return runAction(async () => {
    const adminEmail = await assertAdminEmail();

    const patch = buildGroqPatch(input);
    const updated = await updateSetting('ai', patch);
    await writeAudit(adminEmail, 'settings_update_ai_groq', 'ai');
    revalidatePath('/admincenter/settings/ai');
    return toGroqView(updated);
  });
}

// ---------------------------------------------------------------------------
// 讀取可用模型
// ---------------------------------------------------------------------------

export interface ModelListResult {
  ok: boolean;
  models: string[];
  error: string;
}

/**
 * 打 OpenAI 相容端點的 `/models`，回傳供應商目前可用的模型 id 清單。
 * CostScale 閘道（LiteLLM Proxy）與 Groq 都遵循這個介面。
 */
async function fetchOpenAiCompatibleModels(url: string, apiKey: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`連線失敗：${errorMessage(error)}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`讀取模型清單失敗：HTTP ${response.status}：${text.slice(0, 200)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`模型清單回應非 JSON（${errorMessage(error)}）：${text.slice(0, 200)}`);
  }

  const data =
    typeof json === 'object' && json !== null && 'data' in json && Array.isArray((json as { data: unknown }).data)
      ? (json as { data: unknown[] }).data
      : [];
  const ids = data
    .map((item) =>
      typeof item === 'object' && item !== null && 'id' in item && typeof (item as { id: unknown }).id === 'string'
        ? (item as { id: string }).id
        : null,
    )
    .filter((id): id is string => id !== null && id !== '');

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export interface FetchGatewayModelsInput {
  /** 留空表示使用目前已保存的閘道網址。 */
  gatewayUrl?: string;
  /** 留空表示使用目前已保存的金鑰。 */
  apiKey?: string;
}

/** 讀取 CostScale 閘道可用模型：優先用輸入框裡的金鑰，沒有就用已保存的。 */
export async function fetchGatewayModelsAction(
  input: FetchGatewayModelsInput = {},
): Promise<ModelListResult> {
  await assertAdminEmail();

  const current = await getSetting('ai');
  const gatewayUrl = input.gatewayUrl?.trim() || current.gatewayUrl;
  const apiKey = input.apiKey?.trim() || current.apiKey;

  if (!gatewayUrl || !apiKey) {
    return { ok: false, models: [], error: '尚未設定閘道網址或金鑰，無法讀取模型清單。' };
  }

  try {
    const models = await fetchOpenAiCompatibleModels(`${trimTrailingSlash(gatewayUrl)}/v1/models`, apiKey);
    return { ok: true, models, error: '' };
  } catch (error) {
    return { ok: false, models: [], error: errorMessage(error) };
  }
}

export interface FetchGroqModelsInput {
  /** 留空表示使用目前已保存的 Groq 位址。 */
  baseUrl?: string;
  /** 留空表示使用目前已保存的金鑰清單第一支；填了則用這段文字解析出的第一支。 */
  apiKeysText?: string;
}

/** 讀取 Groq 可用模型：多支金鑰時用第一支去問。 */
export async function fetchGroqModelsAction(
  input: FetchGroqModelsInput = {},
): Promise<ModelListResult> {
  await assertAdminEmail();

  const current = await getSetting('ai');
  const baseUrl = input.baseUrl?.trim() || current.groqBaseUrl;
  const keys = input.apiKeysText?.trim() ? parseGroqKeysText(input.apiKeysText) : current.groqApiKeys;

  if (keys.length === 0) {
    return { ok: false, models: [], error: '尚未設定任何 Groq 金鑰，無法讀取模型清單。' };
  }

  try {
    const models = await fetchOpenAiCompatibleModels(`${trimTrailingSlash(baseUrl)}/models`, keys[0]);
    return { ok: true, models, error: '' };
  } catch (error) {
    return { ok: false, models: [], error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// 測試真實生成：顯示 AI 回的原文，不是只顯示成功或失敗
// ---------------------------------------------------------------------------

/**
 * 兩個供應商呼叫端都強制要求 JSON 物件回應格式（見 `gateway.ts` 的
 * `callGateway`／`callGroq`），因此提示詞刻意要求模型把自我介紹放進
 * `reply` 欄位，讓管理員仍能從這段 JSON 裡的文字判斷「這是不是我要的
 * 那個模型的口氣」。
 */
const TEST_GENERATION_PROMPT =
  '請用一句自然的繁體中文簡短自我介紹，讓人一眼看出是哪個模型在回覆，並以 JSON 格式回傳，例如：{"reply": "你的自我介紹句子"}';

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  /** AI 回應的原文，不論成功或失敗都盡量帶出可辨識的內容。 */
  reply: string;
  error: string;
}

export interface TestGatewayGenerationInput {
  gatewayUrl?: string;
  apiKey?: string;
  model?: string;
}

/** 測試 CostScale 閘道的真實生成：預設用已保存的設定，也接受暫時代入尚未保存的值。 */
export async function testGatewayGenerationAction(
  input: TestGatewayGenerationInput = {},
): Promise<ProviderTestResult> {
  await assertAdminEmail();

  const current = await getSetting('ai');
  const gatewayUrl = input.gatewayUrl?.trim() || current.gatewayUrl;
  const apiKey = input.apiKey?.trim() || current.apiKey;
  const model = input.model?.trim() || current.primaryModel;

  if (!gatewayUrl || !apiKey) {
    return { ok: false, latencyMs: 0, reply: '', error: '尚未設定閘道網址或金鑰，無法測試。' };
  }

  const start = Date.now();
  try {
    const result = await callGateway({
      baseUrl: gatewayUrl,
      apiKey,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: TEST_GENERATION_PROMPT }] }],
      // 設定裡沒填時退回中性字串；寫死作者的代號會讓公開版帶著作者的識別跑。
      clientId: current.costClientId || 'dating-contract-checker',
      feature: 'admin_test_generation',
      timeoutMs: 20000,
    });
    return { ok: true, latencyMs: Date.now() - start, reply: result.content, error: '' };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, reply: '', error: errorMessage(error) };
  }
}

export interface TestGroqGenerationInput {
  baseUrl?: string;
  apiKeysText?: string;
  model?: string;
}

export interface GroqGenerationTestView {
  /** 金鑰在清單中的序號，從 1 開始。 */
  index: number;
  /** 只顯示最後四碼，絕不回傳完整金鑰。 */
  keyTail: string;
  ok: boolean;
  latencyMs: number;
  reply: string;
  error: string;
}

/** 測試 Groq 真實生成：逐支金鑰各送一次，回報每一支的原文回覆或失敗原因。 */
export async function testGroqGenerationAction(
  input: TestGroqGenerationInput = {},
): Promise<GroqGenerationTestView[]> {
  await assertAdminEmail();

  const current = await getSetting('ai');
  const baseUrl = input.baseUrl?.trim() || current.groqBaseUrl;
  const model = input.model?.trim() || current.groqModel;
  const keys = input.apiKeysText?.trim() ? parseGroqKeysText(input.apiKeysText) : current.groqApiKeys;

  const results: GroqGenerationTestView[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const start = Date.now();
    try {
      const result = await callGroq({
        baseUrl,
        apiKey: keys[i],
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: TEST_GENERATION_PROMPT }] }],
        timeoutMs: 20000,
      });
      results.push({
        index: i + 1,
        keyTail: keyTail(keys[i]),
        ok: true,
        latencyMs: Date.now() - start,
        reply: result.content,
        error: '',
      });
    } catch (error) {
      results.push({
        index: i + 1,
        keyTail: keyTail(keys[i]),
        ok: false,
        latencyMs: Date.now() - start,
        reply: '',
        error: errorMessage(error),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 執行診斷：能不能通、出口 IP、延遲毫秒
// ---------------------------------------------------------------------------

export interface DiagnosisResult {
  ok: boolean;
  latencyMs: number;
  /** 查不到時為「無法取得」。 */
  egressIp: string;
  error: string;
}

export interface DiagnoseGatewayInput {
  gatewayUrl?: string;
  apiKey?: string;
  model?: string;
}

/** CostScale 閘道診斷：連線測試與出口 IP 查詢平行進行。 */
export async function diagnoseGatewayAction(
  input: DiagnoseGatewayInput = {},
): Promise<DiagnosisResult> {
  await assertAdminEmail();

  const current = await getSetting('ai');
  const gatewayUrl = input.gatewayUrl?.trim() || current.gatewayUrl;
  const apiKey = input.apiKey?.trim() || current.apiKey;
  const model = input.model?.trim() || current.primaryModel;

  const egressIpPromise = getEgressIp();

  if (!gatewayUrl || !apiKey) {
    return { ok: false, latencyMs: 0, egressIp: await egressIpPromise, error: '尚未設定閘道網址或金鑰，無法診斷。' };
  }

  const [connection, egressIp] = await Promise.all([testConnection(gatewayUrl, apiKey, model), egressIpPromise]);
  return { ok: connection.ok, latencyMs: connection.latencyMs, egressIp, error: connection.error };
}

export interface DiagnoseGroqInput {
  baseUrl?: string;
  apiKeysText?: string;
  model?: string;
}

/** Groq 診斷：用清單中的第一支金鑰做連線測試，與出口 IP 查詢平行進行。 */
export async function diagnoseGroqAction(input: DiagnoseGroqInput = {}): Promise<DiagnosisResult> {
  await assertAdminEmail();

  const current = await getSetting('ai');
  const baseUrl = input.baseUrl?.trim() || current.groqBaseUrl;
  const model = input.model?.trim() || current.groqModel;
  const keys = input.apiKeysText?.trim() ? parseGroqKeysText(input.apiKeysText) : current.groqApiKeys;

  const egressIpPromise = getEgressIp();

  if (keys.length === 0) {
    return { ok: false, latencyMs: 0, egressIp: await egressIpPromise, error: '尚未設定任何 Groq 金鑰，無法診斷。' };
  }

  const [[result], egressIp] = await Promise.all([testGroqKeys(baseUrl, [keys[0]], model), egressIpPromise]);
  return { ok: result.ok, latencyMs: result.latencyMs, egressIp, error: result.error };
}

// ---------------------------------------------------------------------------
// 濫用規則
// ---------------------------------------------------------------------------

/** 更新濫用規則設定（R1 至 R5、暫停時長、每日次數、上傳門檻）。 */
export async function updateAbuseRulesAction(
  patch: AbuseRulesSettings,
): Promise<ActionResult<AbuseRulesSettings>> {
  return runAction(async () => {
    const adminEmail = await assertAdminEmail();

    // 封鎖門檻不大於暫停門檻的話，累計次數會一路跳過「暫停」直接封鎖，
    // 使用者連一次緩衝都沒有。zod schema 只驗得了單一欄位，跨欄位的
    // 關係要在這裡擋。
    if (patch.offTopicBlockThreshold <= patch.offTopicSuspendThreshold) {
      throw new Error(
        `非目標文件的封鎖門檻（${patch.offTopicBlockThreshold}）必須大於暫停門檻（${patch.offTopicSuspendThreshold}），否則使用者會直接被封鎖而沒有暫停這一段緩衝。`,
      );
    }

    const updated = await updateSetting('abuse_rules', patch);
    await writeAudit(adminEmail, 'settings_update_abuse_rules', 'abuse_rules');
    revalidatePath('/admincenter/settings/ai');
    return updated;
  });
}

// ---------------------------------------------------------------------------
// 保留期
// ---------------------------------------------------------------------------

/** 更新保留期設定（分析結果、原始檔案）。 */
export async function updateRetentionAction(
  patch: RetentionSettings,
): Promise<ActionResult<RetentionSettings>> {
  return runAction(async () => {
    const adminEmail = await assertAdminEmail();
    const updated = await updateSetting('retention', patch);
    await writeAudit(adminEmail, 'settings_update_retention', 'retention');
    revalidatePath('/admincenter/settings/ai');
    return updated;
  });
}

// ---------------------------------------------------------------------------
// 備援鏈狀態
// ---------------------------------------------------------------------------

export type { ChainStatusView, ChainLayerView, ChainLayerStatusKind } from '@/lib/ai/chain-status';

/**
 * 供「備援鏈狀態」表格用：讀鏈的靜態定義、熔斷狀態、近 30 天統計。
 *
 * 實際組資料的邏輯在 `getChainStatus`（`@/lib/ai/chain-status`），這裡
 * 只包一層管理員身分檢查——`page.tsx` 首次載入時直接呼叫 `getChainStatus`
 * 本身即可（與其他設定一樣是一般的伺服器端資料讀取），這個 action 留給
 * 之後如果要在用戶端加「重新整理」按鈕時使用。
 */
export async function getChainStatusAction(): Promise<ChainStatusView> {
  await assertAdminEmail();
  const ai = await getSetting('ai');
  return getChainStatus(ai);
}
