import 'server-only';

import type { Edition } from './types';

/**
 * 環境變數的單一讀取點。
 *
 * 原則：只有「部署時就固定、且不該讓管理員在後台改」的東西放環境變數。
 * AI 閘道網址、金鑰、模型、收件信箱、SMTP、濫用閾值一律放資料庫的
 * settings 表，由後台設定頁維護。
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `缺少必要的環境變數 ${name}。請參考 .env.example 補齊後重新啟動。`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/** 前面有哪一種代理。見 `env.trustedProxy` 的說明。 */
export type TrustedProxy = 'cloudflare' | 'nginx' | 'none';

function parseTrustedProxy(): TrustedProxy {
  const raw = optional('TRUSTED_PROXY', 'none').toLowerCase();
  if (raw !== 'cloudflare' && raw !== 'nginx' && raw !== 'none') {
    throw new Error(
      `TRUSTED_PROXY 只接受 cloudflare、nginx 或 none，目前是「${raw}」。`,
    );
  }
  return raw;
}

function parseEdition(): Edition {
  const raw = optional('EDITION', 'private').toLowerCase();
  if (raw !== 'private' && raw !== 'public') {
    throw new Error(
      `EDITION 只接受 private 或 public，目前是「${raw}」。`,
    );
  }
  return raw;
}

export const env = {
  /** 版本。public 為 GitHub 公開版，不回傳任何資料。 */
  edition: parseEdition(),

  /** 前台網域，例如 check.example.com。開發時為 localhost:3400。 */
  publicHost: optional('PUBLIC_HOST', 'localhost:3400'),

  /**
   * 後台網域。留空代表後台與前台共用同一個網址，放在 /admincenter 底下。
   * 填入不同的網域則切換成「後台獨立網域」模式，見 src/proxy.ts。
   */
  adminHost: optional('ADMIN_HOST', ''),

  databaseUrl: required('DATABASE_URL'),

  /** 加密資料庫內的 AI 金鑰與 SMTP 密碼。32 位元組的 base64。 */
  encryptionKey: required('APP_ENCRYPTION_KEY'),

  authSecret: required('AUTH_SECRET'),
  googleClientId: optional('AUTH_GOOGLE_ID', ''),
  googleClientSecret: optional('AUTH_GOOGLE_SECRET', ''),

  /** 後台白名單信箱，逗號分隔。 */
  adminEmails: optional('ADMIN_EMAILS', '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  /**
   * 前面有哪一種代理。決定 `getClientIp` 從哪裡取來源位址。
   *
   * `cloudflare`：正式環境。只認 Cloudflare 覆寫的 CF-Connecting-IP。
   * `nginx`：只有自架反向代理、沒有 Cloudflare。取轉發標頭最右邊那一段。
   * `none`：沒有任何代理（開發環境）。完全忽略標頭。
   *
   * 這個值設錯會讓整套防濫用失效，所以預設是最保守的 `none`
   * （最壞情況是把所有人算成同一個來源，功能變嚴格，不會變成沒防護）。
   */
  trustedProxy: parseTrustedProxy(),

  /** 上傳檔案的存放目錄。 */
  uploadDir: optional('UPLOAD_DIR', './data/uploads'),

  timezone: optional('TZ', 'Asia/Taipei'),
} as const;

export const isPublicEdition = env.edition === 'public';

/**
 * 啟動檢查。在 instrumentation.ts 呼叫，設定有矛盾時直接讓服務起不來，
 * 而不是安靜地跑出錯誤行為。
 */
export function assertEnvConsistency(): void {
  if (env.adminEmails.length === 0) {
    throw new Error('ADMIN_EMAILS 不能為空，否則沒有人能登入後台。');
  }

  try {
    const key = Buffer.from(env.encryptionKey, 'base64');
    if (key.length !== 32) {
      throw new Error(`長度為 ${key.length} 位元組`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `APP_ENCRYPTION_KEY 必須是 32 位元組的 base64 字串（${detail}）。` +
        '可用 openssl rand -base64 32 產生。',
    );
  }
}
