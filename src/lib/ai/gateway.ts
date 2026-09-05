/**
 * AI CostScale 閘道（LiteLLM Proxy）呼叫層。
 *
 * 只用 Node 內建 fetch 打 OpenAI 相容端點，不裝供應商 SDK。網址與金鑰一律
 * 由呼叫端傳入，不寫死在程式碼裡（見設計文件第七之一章）。
 */

import type { TokenUsage } from '@/lib/types';

import type { ChatMessage } from './prompt';

export interface CallGatewayOptions {
  /** 閘道網址，例如 https://閘道主機名稱，不含結尾斜線亦可。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** 成本歸戶：metadata.client_id。 */
  clientId: string;
  /** 成本歸戶：metadata.feature。 */
  feature: string;
  /** 逾時毫秒數，預設 120000。 */
  timeoutMs?: number;
  /** 限制模型輸出的最大 token 數，不帶則不限制。 */
  maxOutputTokens?: number;
}

export interface CallGatewayResult {
  content: string;
  usage: TokenUsage;
  model: string;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  reply: string;
  error: string;
}

const DEFAULT_TIMEOUT_MS = 120000;

/**
 * 閘道／Groq 呼叫失敗時統一拋出的錯誤型別。
 *
 * 除了原本的 `usage`（HTTP 回應本身仍帶了可辨識的 `usage` 欄位時使用，例如
 * 額度用罄、內容被擋下等錯誤，供應商仍會回報已消耗的 token 數，讓呼叫端
 * 即使在某支金鑰失敗時也能把這次實際消耗的 token 併入總用量），還帶了
 * `status`（HTTP 狀態碼）與 `kind`（逾時／網路／HTTP／回應非 JSON）兩個
 * 結構化欄位，供 `chain.ts` 的 `classifyError` 判斷這次失敗屬於備援鏈
 * 六種分類中的哪一種，不必再從錯誤訊息文字裡猜。訊息內容一律不含金鑰本身。
 */
export class GatewayCallError extends Error {
  usage?: TokenUsage;
  status?: number;
  kind?: 'timeout' | 'network' | 'http' | 'invalid_json';

  constructor(
    message: string,
    options?: { usage?: TokenUsage; status?: number; kind?: GatewayCallError['kind'] },
  ) {
    super(message);
    this.name = 'GatewayCallError';
    this.usage = options?.usage;
    this.status = options?.status;
    this.kind = options?.kind;
  }
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 呼叫閘道的 `/v1/chat/completions`，要求模型以 JSON 物件格式回覆。
 *
 * 錯誤處理：HTTP 非 2xx 拋出含狀態碼與回應內文前 300 字的中文錯誤；逾時與
 * 網路錯誤各有可辨識的訊息。apiKey 不會出現在任何錯誤訊息或紀錄中。
 */
export async function callGateway(options: CallGatewayOptions): Promise<CallGatewayResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${trimTrailingSlash(options.baseUrl)}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    response_format: { type: 'json_object' },
    metadata: {
      client_id: options.clientId,
      feature: options.feature,
    },
  };
  if (options.maxOutputTokens !== undefined) {
    body.max_tokens = options.maxOutputTokens;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new GatewayCallError(`AI 閘道逾時：超過 ${timeoutMs} 毫秒未回應。`, { kind: 'timeout' });
    }
    throw new GatewayCallError(`AI 閘道連線失敗：${errorMessage(error)}`, { kind: 'network' });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new GatewayCallError(`AI 閘道回應錯誤 HTTP ${response.status}：${text.slice(0, 300)}`, {
      status: response.status,
      kind: 'http',
    });
  }

  let json: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new GatewayCallError(`AI 閘道回應非 JSON（${errorMessage(error)}）：${text.slice(0, 300)}`, {
      kind: 'invalid_json',
    });
  }

  const content = json.choices?.[0]?.message?.content ?? '';
  const usage: TokenUsage = {
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };

  return { content, usage, model: json.model ?? options.model };
}

export interface CallGroqOptions {
  /** Groq 的 OpenAI 相容 API 位址，例如 https://api.groq.com/openai/v1。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** 逾時毫秒數，預設 120000。 */
  timeoutMs?: number;
  /** 限制模型輸出的最大 token 數，不帶則不限制。 */
  maxOutputTokens?: number;
}

/**
 * 呼叫 Groq 的 `/chat/completions`（Groq 的 OpenAI 相容端點本身已含
 * `/openai/v1`，因此不像 `callGateway` 再多接一段 `/v1`）。
 *
 * 錯誤處理與 `callGateway` 相同的原則：HTTP 非 2xx、逾時、網路錯誤、回應
 * 非 JSON 都拋出不含金鑰內容的中文錯誤；HTTP 非 2xx 的回應若仍帶得出
 * `usage` 欄位，會包在 `GatewayCallError.usage` 上，讓呼叫端能把這次已
 * 消耗的 token 併入總用量。
 */
export async function callGroq(options: CallGroqOptions): Promise<CallGatewayResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${trimTrailingSlash(options.baseUrl)}/chat/completions`;

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    response_format: { type: 'json_object' },
  };
  if (options.maxOutputTokens !== undefined) {
    body.max_tokens = options.maxOutputTokens;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new GatewayCallError(`Groq 逾時：超過 ${timeoutMs} 毫秒未回應。`, { kind: 'timeout' });
    }
    throw new GatewayCallError(`Groq 連線失敗：${errorMessage(error)}`, { kind: 'network' });
  }

  const text = await response.text();

  type GroqResponseBody = {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };

  if (!response.ok) {
    let usage: TokenUsage | undefined;
    try {
      const parsed = JSON.parse(text) as GroqResponseBody;
      if (parsed.usage) {
        usage = {
          inputTokens: parsed.usage.prompt_tokens ?? 0,
          outputTokens: parsed.usage.completion_tokens ?? 0,
        };
      }
    } catch {
      // 錯誤回應本來就不一定是 JSON，解析不出來就當作沒有可用量。
    }
    throw new GatewayCallError(`Groq 回應錯誤 HTTP ${response.status}：${text.slice(0, 300)}`, {
      usage,
      status: response.status,
      kind: 'http',
    });
  }

  let json: GroqResponseBody;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new GatewayCallError(`Groq 回應非 JSON（${errorMessage(error)}）：${text.slice(0, 300)}`, {
      kind: 'invalid_json',
    });
  }

  const content = json.choices?.[0]?.message?.content ?? '';
  const usage: TokenUsage = {
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };

  return { content, usage, model: json.model ?? options.model };
}

export interface GroqKeyTestResult {
  /** 金鑰在清單中的序號，從 1 開始。 */
  index: number;
  ok: boolean;
  latencyMs: number;
  error: string;
}

/**
 * 後台「測試 Groq 連線」按鈕用：逐支金鑰各送一句簡短提示，回報每一支是否
 * 可用。刻意逐支循序測試（不平行），避免瞬間對 Groq 打出一批請求。
 */
export async function testGroqKeys(
  baseUrl: string,
  apiKeys: string[],
  model: string,
): Promise<GroqKeyTestResult[]> {
  const results: GroqKeyTestResult[] = [];
  for (let i = 0; i < apiKeys.length; i += 1) {
    const start = Date.now();
    try {
      await callGroq({
        baseUrl,
        apiKey: apiKeys[i],
        model,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '請只回傳 JSON：{"reply": "測試成功"}' }],
          },
        ],
        timeoutMs: 15000,
      });
      results.push({ index: i + 1, ok: true, latencyMs: Date.now() - start, error: '' });
    } catch (error) {
      results.push({ index: i + 1, ok: false, latencyMs: Date.now() - start, error: errorMessage(error) });
    }
  }
  return results;
}

/** 後台「測試連線」按鈕用：送一句簡短提示，回傳是否成功、延遲與回覆內容。 */
export async function testConnection(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<TestConnectionResult> {
  const start = Date.now();
  try {
    const result = await callGateway({
      baseUrl,
      apiKey,
      model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '請只回傳 JSON：{"reply": "測試成功"}' }],
        },
      ],
      // 連線測試不做成本歸戶，用固定的中性字串即可；寫死作者的代號會讓
      // 公開版帶著作者的識別跑，也讓稽核者搜不乾淨。
      clientId: 'connection-test',
      feature: 'test_connection',
      timeoutMs: 15000,
    });
    return { ok: true, latencyMs: Date.now() - start, reply: result.content, error: '' };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, reply: '', error: errorMessage(error) };
  }
}
