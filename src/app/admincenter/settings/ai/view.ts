import type { AiSettings } from '@/lib/settings';

/**
 * 兩張供應商卡片共用的「對外顯示型態」與組裝邏輯。
 *
 * 獨立成這個檔案（而不是放進 `actions/settings.ts`）的原因：
 * `actions/settings.ts` 有 `'use server'` 指示詞，該檔案裡「匯出」的
 * 名稱只能是 async 函式或型別，不能匯出一般的同步函式；但 `page.tsx`
 * 這種伺服器元件想直接組出初次載入的畫面資料時，並不需要多繞一層
 * 伺服器動作（那是給用戶端互動用的），直接呼叫同步函式即可。
 */

/** 只取最後四碼，供畫面顯示「已保存尾碼」；不足四碼就整串顯示。 */
export function keyTail(value: string): string {
  if (value === '') {
    return '';
  }
  return value.length <= 4 ? value : value.slice(-4);
}

export interface GatewayProviderView {
  gatewayUrl: string;
  hasApiKey: boolean;
  /** 只有最後四碼；`hasApiKey` 為 false 時為空字串。 */
  apiKeyTail: string;
  primaryModel: string;
  fallbackModel: string;
  maxInputTokens: number;
  costClientId: string;
  /** 目前是否在備援鏈中生效：網址與金鑰都已設定。 */
  active: boolean;
}

export function toGatewayView(value: AiSettings): GatewayProviderView {
  const hasApiKey = value.apiKey !== '';
  return {
    gatewayUrl: value.gatewayUrl,
    hasApiKey,
    apiKeyTail: hasApiKey ? keyTail(value.apiKey) : '',
    primaryModel: value.primaryModel,
    fallbackModel: value.fallbackModel,
    maxInputTokens: value.maxInputTokens,
    costClientId: value.costClientId,
    active: value.gatewayUrl !== '' && hasApiKey,
  };
}

export interface GroqProviderView {
  enabled: boolean;
  baseUrl: string;
  model: string;
  keyCount: number;
  /** 每支金鑰只顯示最後四碼，依原本存放順序排列。 */
  keyTails: string[];
  /** 目前是否在備援鏈中生效：啟用開關開啟且至少有一支金鑰。 */
  active: boolean;
}

export function toGroqView(value: AiSettings): GroqProviderView {
  return {
    enabled: value.groqEnabled,
    baseUrl: value.groqBaseUrl,
    model: value.groqModel,
    keyCount: value.groqApiKeys.length,
    keyTails: value.groqApiKeys.map((key) => keyTail(key)),
    active: value.groqEnabled && value.groqApiKeys.length > 0,
  };
}

export interface AiSettingsView {
  gateway: GatewayProviderView;
  groq: GroqProviderView;
}

export function toAiSettingsView(value: AiSettings): AiSettingsView {
  return { gateway: toGatewayView(value), groq: toGroqView(value) };
}

// ---------------------------------------------------------------------------
// 保存時的「留空表示不修改」邏輯：抽成純函式，讓伺服器動作與驗證腳本
// 呼叫的是同一份邏輯，不是驗證腳本自己重新刻一次容易兜不起來的複製品。
// ---------------------------------------------------------------------------

/** 把多行文字框的內容拆成金鑰清單：一行一支，去除頭尾空白與空行。 */
export function parseGroqKeysText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface GatewayPatchInput {
  gatewayUrl: string;
  /** 空字串表示不修改已保存的金鑰。 */
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
  maxInputTokens: number;
  costClientId: string;
}

/** 組出保存 CostScale 閘道設定要合併寫入的 patch；金鑰欄位留空就不放進 patch。 */
export function buildGatewayPatch(input: GatewayPatchInput): Partial<AiSettings> {
  const patch: Partial<AiSettings> = {
    gatewayUrl: input.gatewayUrl.trim(),
    primaryModel: input.primaryModel.trim(),
    fallbackModel: input.fallbackModel.trim(),
    maxInputTokens: input.maxInputTokens,
    costClientId: input.costClientId.trim(),
  };
  if (input.apiKey.trim() !== '') {
    patch.apiKey = input.apiKey.trim();
  }
  return patch;
}

export interface GroqPatchInput {
  enabled: boolean;
  /** 多行文字，一行一支金鑰；空字串表示不修改已保存的金鑰清單，填了就整批取代。 */
  apiKeysText: string;
  baseUrl: string;
  model: string;
}

/** 組出保存 Groq 設定要合併寫入的 patch；金鑰清單留空就不放進 patch。 */
export function buildGroqPatch(input: GroqPatchInput): Partial<AiSettings> {
  const patch: Partial<AiSettings> = {
    groqEnabled: input.enabled,
    groqBaseUrl: input.baseUrl.trim(),
    groqModel: input.model.trim(),
  };
  if (input.apiKeysText.trim() !== '') {
    patch.groqApiKeys = parseGroqKeysText(input.apiKeysText);
  }
  return patch;
}
