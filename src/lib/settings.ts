import 'server-only';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, schema } from '@/db';
import type { SettingKey } from './types';

import { decrypt, encrypt } from './crypto';
import { isPublicEdition } from './env';

/**
 * 系統設定的型別安全讀寫。
 *
 * 五組設定各自有兩種型態：
 * - 「對外型態」（Public*Settings）：呼叫端看到與寫入的形狀，金鑰／密碼
 *   欄位是明文。
 * - 「儲存型態」（Stored*Settings）：實際存進 `settings.value_json` 的
 *   形狀，金鑰／密碼欄位是 `src/lib/crypto.ts` 加密後的密文，`null`
 *   代表「從未設定」。
 *
 * `getSetting` 負責把儲存型態解密還原成對外型態；`updateSetting`
 * 負責把對外型態的明文加密後合併寫入。
 */

// ---------------------------------------------------------------------------
// ai
// ---------------------------------------------------------------------------

/**
 * AI 閘道網址的預設值。
 *
 * 只在管理員還沒到後台填寫時當作起始值，填過之後就以資料庫為準。
 *
 * 這個值刻意不寫在程式碼裡，改由環境變數 `DEFAULT_AI_GATEWAY_URL` 提供，
 * 原因有兩個：
 * 1. 部署這套程式的可能是任何單位。預設值若指向某個特定的第三方位址，
 *    對方只要沒改設定，合約內容就會被送到一個他沒有選擇過的地方。
 * 2. 原始碼中完全不出現任何特定網域，稽核者用一次搜尋就能確認這件事，
 *    不必逐行讀完整個專案（見 docs/PRIVACY.md）。
 *
 * 公開版即使有人在環境變數裡填了值也一律忽略，維持空字串。
 */
const DEFAULT_GATEWAY_URL = isPublicEdition
  ? ''
  : (process.env.DEFAULT_AI_GATEWAY_URL ?? '');

/**
 * 成本歸戶用的 client id 預設值。
 *
 * 與 `DEFAULT_GATEWAY_URL` 同一個道理：這個值會隨每一次 AI 請求送到閘道，
 * 用來在閘道端做成本歸戶。部署者應該填自己的代號，因此原始碼裡不寫死
 * 任何特定代號，改由環境變數提供。
 */
const DEFAULT_COST_CLIENT_ID = isPublicEdition
  ? 'dating-contract-checker'
  : (process.env.DEFAULT_COST_CLIENT_ID ?? 'dating-contract-checker');

export const aiSettingsSchema = z.object({
  /** AI 閘道網址。公開版預設為空字串，必須由部署者自行填寫。 */
  gatewayUrl: z.string().default(DEFAULT_GATEWAY_URL),
  /** 明文虛擬金鑰。未設定為空字串。 */
  apiKey: z.string().default(''),
  /** 主要模型別名。 */
  primaryModel: z.string().default('gemini-2.5-flash'),
  /** 主要模型連續失敗時的備援模型別名。 */
  fallbackModel: z.string().default('gemini-flash-paid'),
  /** 每次分析輸入 token 上限，超過時先截斷合約文字。 */
  maxInputTokens: z.number().int().positive().default(200000),
  /** 成本歸戶用的 client id，帶在 metadata.client_id。 */
  costClientId: z.string().default(DEFAULT_COST_CLIENT_ID),
  /** Groq 金鑰輪替總開關。關閉時純文字分析一律直接走 Gemini 閘道。 */
  groqEnabled: z.boolean().default(false),
  /** 明文 Groq 金鑰清單，每次純文字分析隨機洗牌後依序嘗試。空陣列代表沒有金鑰。 */
  groqApiKeys: z.array(z.string()).default([]),
  /** Groq 的 OpenAI 相容 API 位址。 */
  groqBaseUrl: z.string().default('https://api.groq.com/openai/v1'),
  /**
   * Groq 模型別名。這一層只處理純文字，模型本身也只吃文字
   * （`openai/gpt-oss-120b` 的 INPUT 是 Text，2026-09-05 查證於 Groq 官方
   * 模型頁）。要處理掃描檔或照片得換成 Groq 的視覺模型，見
   * `src/lib/ai/chain.ts` 對影像為何走閘道的說明。
   */
  groqModel: z.string().default('openai/gpt-oss-120b'),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

/**
 * 儲存型態的每一個欄位都必須有預設值。
 *
 * 這不是可有可無的防禦，是踩過的坑：新增 Groq 那四個欄位後，正式環境
 * 資料庫裡那筆在更早以前寫入的 `ai` 設定沒有這些欄位，`parse()` 直接拋錯，
 * 導致**整個後台打不開**——每一頁都要讀 AI 設定。本機測試沒發現，因為
 * 驗證腳本跑過 `updateSetting`，那一列早就被改寫成新格式。
 *
 * 通則：設定資料是長期存在的，永遠會落後於程式碼。往後新增任何欄位，
 * 儲存型態這邊一律要給預設值，讓舊資料能被讀出來並自動補齊，
 * 而不是讓服務因為一筆舊資料而整個停擺。
 */
const aiSettingsStoredSchema = z.object({
  gatewayUrl: z.string().default(DEFAULT_GATEWAY_URL),
  /** 加密後的虛擬金鑰密文；null 代表從未設定過。 */
  encryptedApiKey: z.string().nullable().default(null),
  primaryModel: z.string().default('gemini-2.5-flash'),
  fallbackModel: z.string().default('gemini-flash-paid'),
  maxInputTokens: z.number().int().positive().default(200000),
  costClientId: z.string().default(DEFAULT_COST_CLIENT_ID),
  groqEnabled: z.boolean().default(false),
  /** 加密後的 Groq 金鑰密文陣列；空陣列代表從未設定過。 */
  encryptedGroqApiKeys: z.array(z.string()).default([]),
  groqBaseUrl: z.string().default('https://api.groq.com/openai/v1'),
  groqModel: z.string().default('openai/gpt-oss-120b'),
});
type AiSettingsStored = z.infer<typeof aiSettingsStoredSchema>;

// ---------------------------------------------------------------------------
// analysis_hook
// ---------------------------------------------------------------------------

/**
 * 分析完成後的擴充處理設定。
 *
 * 這組設定屬於 `src/lib/email/hooks.ts` 掛上來的擴充；沒有掛任何擴充的
 * 部署不會讀到它，欄位的意義也由該擴充自己決定。核心只負責存取。
 */
export const analysisHookSettingsSchema = z.object({
  /** 總開關。關閉時擴充不執行。 */
  enabled: z.boolean().default(false),
  /** 處理對象清單。格式由擴充自行定義，核心只驗證為字串陣列。 */
  targets: z.array(z.string()).default([]),
  /** 單次處理的內容量上限（位元組）。超過時由擴充決定改用什麼方式。 */
  maxPayloadBytes: z.number().int().positive().default(20 * 1024 * 1024),
});
export type AnalysisHookSettings = z.infer<typeof analysisHookSettingsSchema>;

// 沒有金鑰或密碼欄位，儲存型態與對外型態相同。
const analysisHookSettingsStoredSchema = analysisHookSettingsSchema;

// ---------------------------------------------------------------------------
// abuse_rules
// ---------------------------------------------------------------------------

export const abuseRulesSettingsSchema = z.object({
  /** R1：單一 IP 60 秒內上傳請求數超過此值即暫停。 */
  r1UploadPer60s: z.number().int().positive().default(15),
  /** R2：單一 IP 60 秒內分析請求數超過此值即暫停。 */
  r2AnalyzePer60s: z.number().int().positive().default(5),
  /** R3：單一 IP 10 分鐘內失敗或被拒的請求數超過此值即暫停。 */
  r3RejectedPer10Min: z.number().int().positive().default(30),
  /** R4：單一 IP 24 小時內被暫停達此次數即自動封鎖。 */
  r4SuspendCountPer24h: z.number().int().positive().default(3),
  /** R5：全站每日 token 上限（成本熔斷）。 */
  r5DailyTokenLimit: z.number().int().positive().default(3_000_000),
  /** 觸發 R1 至 R4 時的暫停時長（秒）。 */
  suspendDurationSeconds: z.number().int().positive().default(1800),
  /** 每位使用者（瀏覽器識別碼或 IP）每日分析次數上限。 */
  dailyAnalysisLimit: z.number().int().positive().default(30),

  // 以下四項是上傳階段的門檻。放在同一組設定的理由：它們與上面的規則
  // 都由同一層守門程式在請求進來時檢查，分成兩組只會讓那層程式要讀兩次設定。
  /** 單次分析最多可帶幾個檔案（見設計文件第二章第 1 節）。 */
  maxFilesPerBatch: z.number().int().positive().default(20),
  /** 單一圖片檔的大小上限（位元組）。 */
  maxImageBytes: z.number().int().positive().default(8 * 1024 * 1024),
  /** 圖片以外的單檔大小上限（位元組）。 */
  maxDocumentBytes: z.number().int().positive().default(15 * 1024 * 1024),
  /** 直接貼上的文字長度上限（字元數）。 */
  maxPastedTextChars: z.number().int().positive().default(50000),

  // 以下三項對應 2026-09-05「非交友媒合服務契約」的階梯式處置
  // （見 `src/lib/guard/off-topic.ts`）。這一組沿用同一個 `settings` 鍵，
  // 不是獨立的設定分類，理由與上面四項上傳門檻相同：同一層守門程式檢查。
  /**
   * 總開關：關閉時完全不執行偵測與階梯式處置，一律放行。
   *
   * 這個欄位開發期間一度是 1／0 的數字，資料庫裡可能留著那種寫法。
   * 讀到數字時當成布林值處理，不要讓一個欄位的型別變更把整個後台
   * 弄到打不開——那是 2026-09-05 已經發生過一次的事故（見
   * `scripts/verify-settings-compat.ts`）。
   */
  offTopicRuleEnabled: z.preprocess(
    (value) => (typeof value === 'number' ? value !== 0 : value),
    z.boolean(),
  ).default(true),
  /** 同一 IP 累計次數達此值即暫停使用（沿用 `suspendDurationSeconds` 的時長）。 */
  offTopicSuspendThreshold: z.number().int().positive().default(2),
  /** 同一 IP 累計次數達此值即自動封鎖。 */
  offTopicBlockThreshold: z.number().int().positive().default(3),
});
export type AbuseRulesSettings = z.infer<typeof abuseRulesSettingsSchema>;

const abuseRulesSettingsStoredSchema = abuseRulesSettingsSchema;

// ---------------------------------------------------------------------------
// retention
// ---------------------------------------------------------------------------

export const retentionSettingsSchema = z.object({
  /** 分析結果保留天數。 */
  analysisResultDays: z.number().int().positive().default(90),
  /** 原始檔案保留天數，期滿後刪除，結果與抽出的文字仍在。 */
  rawFileDays: z.number().int().positive().default(30),
});
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

const retentionSettingsStoredSchema = retentionSettingsSchema;

// ---------------------------------------------------------------------------
// smtp
// ---------------------------------------------------------------------------

export const smtpSettingsSchema = z.object({
  host: z.string().default(''),
  port: z.number().int().positive().default(587),
  user: z.string().default(''),
  /** 明文密碼。未設定為空字串。 */
  password: z.string().default(''),
  /** 寄件人顯示名稱。 */
  fromName: z.string().default('交友合約健檢'),
});
export type SmtpSettings = z.infer<typeof smtpSettingsSchema>;

/** 同樣每個欄位都給預設值，理由見 `aiSettingsStoredSchema` 上方的說明。 */
const smtpSettingsStoredSchema = z.object({
  host: z.string().default(''),
  port: z.number().int().positive().default(587),
  user: z.string().default(''),
  /** 加密後的密碼密文；null 代表從未設定過。 */
  encryptedPassword: z.string().nullable().default(null),
  fromName: z.string().default('交友合約健檢'),
});
type SmtpSettingsStored = z.infer<typeof smtpSettingsStoredSchema>;

// ---------------------------------------------------------------------------
// 彙總型別與預設值
// ---------------------------------------------------------------------------

/** 各設定鍵對應的對外型態。 */
export interface SettingValueMap {
  ai: AiSettings;
  analysis_hook: AnalysisHookSettings;
  abuse_rules: AbuseRulesSettings;
  retention: RetentionSettings;
  smtp: SmtpSettings;
}

/** 各設定鍵的預設值（對外型態）。 */
export const DEFAULT_SETTINGS: SettingValueMap = {
  ai: aiSettingsSchema.parse({}),
  analysis_hook: analysisHookSettingsSchema.parse({}),
  abuse_rules: abuseRulesSettingsSchema.parse({}),
  retention: retentionSettingsSchema.parse({}),
  smtp: smtpSettingsSchema.parse({}),
};

// ---------------------------------------------------------------------------
// 讀寫實作
// ---------------------------------------------------------------------------

/** 讀出 settings 表裡某個 key 的原始 value_json，沒有該筆時回傳 null。 */
async function readRawValue(key: SettingKey): Promise<unknown | null> {
  const rows = await db
    .select({ valueJson: schema.settings.valueJson })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);
  return rows.length > 0 ? rows[0].valueJson : null;
}

/** 把明文金鑰加密成儲存用的密文；空字串視為「設定為空」，仍會加密。 */
function encryptSecret(plain: string): string {
  return encrypt(plain);
}

/** 把儲存的密文解密回明文；null（未設定）直接回傳空字串，不呼叫解密。 */
function decryptSecret(cipherText: string | null): string {
  if (cipherText === null) {
    return '';
  }
  return decrypt(cipherText);
}

/**
 * 把儲存的密文陣列逐一解密回明文陣列。
 *
 * 解密失敗（例如 `APP_ENCRYPTION_KEY` 與加密時不同、密文被竄改）一律讓
 * `decrypt()` 拋出的中文錯誤往上傳，不安靜略過該筆或回傳空陣列，避免呼叫端
 * 誤把「解密失敗」當成「本來就沒有這支金鑰」。
 */
function decryptSecretList(cipherTexts: string[]): string[] {
  return cipherTexts.map((cipherText) => decrypt(cipherText));
}

async function getAiSetting(): Promise<AiSettings> {
  const raw = await readRawValue('ai');
  if (raw === null) {
    return DEFAULT_SETTINGS.ai;
  }
  const stored = aiSettingsStoredSchema.parse(raw);
  return {
    gatewayUrl: stored.gatewayUrl,
    apiKey: decryptSecret(stored.encryptedApiKey),
    primaryModel: stored.primaryModel,
    fallbackModel: stored.fallbackModel,
    maxInputTokens: stored.maxInputTokens,
    costClientId: stored.costClientId,
    groqEnabled: stored.groqEnabled,
    groqApiKeys: decryptSecretList(stored.encryptedGroqApiKeys),
    groqBaseUrl: stored.groqBaseUrl,
    groqModel: stored.groqModel,
  };
}

async function getSmtpSetting(): Promise<SmtpSettings> {
  const raw = await readRawValue('smtp');
  if (raw === null) {
    return DEFAULT_SETTINGS.smtp;
  }
  const stored = smtpSettingsStoredSchema.parse(raw);
  return {
    host: stored.host,
    port: stored.port,
    user: stored.user,
    password: decryptSecret(stored.encryptedPassword),
    fromName: stored.fromName,
  };
}

async function getPlainSetting<K extends 'analysis_hook' | 'abuse_rules' | 'retention'>(
  key: K,
): Promise<SettingValueMap[K]> {
  const raw = await readRawValue(key);
  if (raw === null) {
    return DEFAULT_SETTINGS[key];
  }
  if (key === 'analysis_hook') {
    return analysisHookSettingsStoredSchema.parse(raw) as SettingValueMap[K];
  }
  if (key === 'abuse_rules') {
    return abuseRulesSettingsStoredSchema.parse(raw) as SettingValueMap[K];
  }
  return retentionSettingsStoredSchema.parse(raw) as SettingValueMap[K];
}

/**
 * 讀取某個設定鍵的目前值。
 *
 * 資料庫沒有這筆設定時回傳預設值，且不會寫回資料庫（維持「讀不到才用
 * 預設值」的語意，不會憑空造出一筆設定紀錄）。
 *
 * `EDITION=public` 時 `analysis_hook` 一律回傳 `enabled: false`，不論資料庫內容
 * 為何，避免這組設定在不支援的部署上被誤開啟。
 */
export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<SettingValueMap[K]> {
  if (key === 'analysis_hook' && isPublicEdition) {
    return { ...DEFAULT_SETTINGS.analysis_hook, enabled: false } as SettingValueMap[K];
  }

  switch (key) {
    case 'ai':
      return (await getAiSetting()) as SettingValueMap[K];
    case 'smtp':
      return (await getSmtpSetting()) as SettingValueMap[K];
    case 'analysis_hook':
    case 'abuse_rules':
    case 'retention':
      return (await getPlainSetting(key)) as SettingValueMap[K];
    default: {
      const exhaustiveCheck: never = key;
      throw new Error(`未知的設定鍵：${String(exhaustiveCheck)}`);
    }
  }
}

/** 把對外型態（含明文金鑰／密碼）的完整值轉成儲存型態並 upsert 進資料庫。 */
async function writeSetting(key: SettingKey, valueJson: unknown): Promise<void> {
  const existing = await db
    .select({ id: schema.settings.id })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.settings)
      .set({ valueJson, updatedAt: new Date() })
      .where(eq(schema.settings.key, key));
  } else {
    await db.insert(schema.settings).values({ key, valueJson });
  }
}

/**
 * 合併寫入某個設定鍵。
 *
 * `patch` 是對外型態的部分欄位（明文金鑰／密碼），會先與目前值合併，
 * 再把金鑰／密碼欄位加密後存入資料庫。
 *
 * `EDITION=public` 時 `analysis_hook` 一律拋錯。
 */
export async function updateSetting<K extends SettingKey>(
  key: K,
  patch: Partial<SettingValueMap[K]>,
): Promise<SettingValueMap[K]> {
  if (key === 'analysis_hook' && isPublicEdition) {
    throw new Error('這個版本無法修改 analysis_hook 設定。');
  }

  const current = await getSetting(key);
  const merged = { ...current, ...patch } as SettingValueMap[K];

  switch (key) {
    case 'ai': {
      const value = aiSettingsSchema.parse(merged);
      const stored: AiSettingsStored = {
        gatewayUrl: value.gatewayUrl,
        encryptedApiKey: encryptSecret(value.apiKey),
        primaryModel: value.primaryModel,
        fallbackModel: value.fallbackModel,
        maxInputTokens: value.maxInputTokens,
        costClientId: value.costClientId,
        groqEnabled: value.groqEnabled,
        encryptedGroqApiKeys: value.groqApiKeys.map((plain) => encryptSecret(plain)),
        groqBaseUrl: value.groqBaseUrl,
        groqModel: value.groqModel,
      };
      await writeSetting(key, stored);
      return value as SettingValueMap[K];
    }
    case 'smtp': {
      const value = smtpSettingsSchema.parse(merged);
      const stored: SmtpSettingsStored = {
        host: value.host,
        port: value.port,
        user: value.user,
        encryptedPassword: encryptSecret(value.password),
        fromName: value.fromName,
      };
      await writeSetting(key, stored);
      return value as SettingValueMap[K];
    }
    case 'analysis_hook': {
      const value = analysisHookSettingsSchema.parse(merged);
      await writeSetting(key, value);
      return value as SettingValueMap[K];
    }
    case 'abuse_rules': {
      const value = abuseRulesSettingsSchema.parse(merged);
      await writeSetting(key, value);
      return value as SettingValueMap[K];
    }
    case 'retention': {
      const value = retentionSettingsSchema.parse(merged);
      await writeSetting(key, value);
      return value as SettingValueMap[K];
    }
    default: {
      const exhaustiveCheck: never = key;
      throw new Error(`未知的設定鍵：${String(exhaustiveCheck)}`);
    }
  }
}
