import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';

import { getSetting, type SmtpSettings } from '@/lib/settings';

/**
 * SMTP 連線層。
 *
 * 連線物件（`Transporter`）建立成本不低（要跟 SMTP 主機交握），所以快取
 * 起來重複使用，不是每封信都重建一個。設定在後台改過之後呼叫
 * `resetTransport()` 讓下一次取用時用新設定重建。
 */

let cached: { transporter: Transporter; signature: string } | null = null;

/**
 * 供 `scripts/verify-email.ts` 注入假的 transport，讓寄信流程不必真的連上
 * SMTP 主機也能被完整驗證（見設計文件驗收條件第 4 點）。一般執行時一律
 * 為 null，`getTransport()` 才會依真正的設定建立連線。
 */
let testOverride: Transporter | null = null;

function signatureOf(settings: SmtpSettings): string {
  return JSON.stringify(settings);
}

function assertComplete(settings: SmtpSettings): void {
  if (!settings.host.trim() || !settings.user.trim()) {
    throw new Error(
      'SMTP 設定不完整：主機（host）與帳號（user）皆為必填，請先到後台的寄信設定頁填妥後再試。',
    );
  }
}

/** 依設定建立一個全新的連線物件；設定不完整時拋出中文錯誤。獨立匯出供直接單元測試。 */
export function buildTransporter(settings: SmtpSettings): Transporter {
  assertComplete(settings);
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    // 密碼留空代表這台 SMTP 主機不需要驗證（例如內網轉信主機），
    // 不強行帶一組空密碼上去交握，避免部分伺服器把空密碼視為驗證失敗。
    auth: settings.password ? { user: settings.user, pass: settings.password } : undefined,
  });
}

/**
 * 讀取目前的 SMTP 設定並回傳（必要時重建）連線物件，設定不完整時拋出中文錯誤。
 * 有測試用的覆寫物件時一律優先回傳它，不去讀資料庫設定。
 */
export async function getTransport(): Promise<Transporter> {
  if (testOverride) {
    return testOverride;
  }

  const settings = await getSetting('smtp');
  const signature = signatureOf(settings);

  if (cached && cached.signature === signature) {
    return cached.transporter;
  }

  const transporter = buildTransporter(settings);
  cached = { transporter, signature };
  return transporter;
}

/** 讓下一次 `getTransport()` 依最新設定重建連線，供設定頁儲存後呼叫。 */
export function resetTransport(): void {
  cached = null;
}

/** 僅供驗證腳本使用：注入或清除假的 transport。傳入 `null` 還原為正常行為。 */
export function setTransportOverride(transporter: Transporter | null): void {
  testOverride = transporter;
}

export interface VerifyTransportResult {
  ok: boolean;
  message: string;
}

/** 後台「測試寄信設定」按鈕用：驗證目前儲存的 SMTP 設定能否與主機交握。 */
export async function verifyTransport(): Promise<VerifyTransportResult> {
  try {
    const transporter = await getTransport();
    await transporter.verify();
    return { ok: true, message: 'SMTP 連線測試成功，可以正常寄信。' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `SMTP 連線測試失敗：${detail}` };
  }
}
