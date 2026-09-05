import 'server-only';

import { randomUUID } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import type { ApiError, ApiErrorCode } from '@/lib/api-contract';
import { CLIENT_ID_COOKIE, CLIENT_ID_MAX_AGE } from '@/lib/api-contract';
import type { GuardResult } from '@/lib/guard';
import { newClientId } from '@/lib/guard/client';
import { env } from '@/lib/env';

/**
 * 請求解析與錯誤回應的共用工具。
 *
 * 給 `src/app/api/*` 底下的路由共用，統一 IP 取得、瀏覽器識別碼 cookie
 * 讀寫、錯誤回應格式（見 `src/lib/api-contract.ts` 的 `ApiError`）。
 */

/**
 * 取得使用者的真實來源位址。
 *
 * 這個函式是整套防濫用機制的地基：每日次數、滑動視窗、暫停與封鎖全都以
 * 它的回傳值為準。取錯了有兩種壞法，第二種尤其危險：
 *
 * 1. 取到代理伺服器自己的位址：所有使用者被算成同一個人，每日 30 次額度
 *    變成全站共用，功能直接壞掉。這種壞法很快會被發現。
 * 2. 取到用戶端可以自己填的值：攻擊者每次請求換一個偽造位址，就能無限
 *    繞過所有速率限制與封鎖，而系統看起來一切正常。**這種壞法不會被發現。**
 *
 * 關鍵認知：**`X-Forwarded-For` 整串都可能是用戶端自己寫的。** 它只有在
 * 「我們自己控制的代理會把真實連線對象附加上去」的前提下才有意義。沒有
 * 代理時，那個標頭從頭到尾都是攻擊者的輸入，取最左段或最右段一樣不可信。
 *
 * 因此取用方式完全由 `TRUSTED_PROXY` 決定，程式不自行猜測：
 *
 * - `cloudflare`：只認 `CF-Connecting-IP`。這個標頭由 Cloudflare 覆寫，
 *   用戶端塞不進來。**前提是防火牆只開放 Cloudflare 的位址連入**，否則
 *   有人直連主機就能自己偽造它。收不到這個標頭代表請求沒經過 Cloudflare，
 *   此時不退而求其次去讀可偽造的標頭，一律歸為同一個未知來源。
 * - `nginx`：取 `X-Forwarded-For` 的**最右邊**一段。nginx 設定
 *   `$proxy_add_x_forwarded_for` 時會把實際連線對象附在最後，那一段是我們
 *   自己的代理寫的，用戶端蓋不掉。
 * - `none`（預設，開發用）：**完全忽略所有標頭**，一律回傳本機位址。
 *   沒有代理就沒有任何可信來源，寧可把所有人算成同一個來源（限制變嚴），
 *   也不要讓人靠改標頭取得無限額度（限制形同虛設）。
 *
 * Fetch API 規格的 `Request` 物件不帶連線層資訊，App Router 的路由處理
 * 常式拿不到底層連線，所以無法真正讀取 TCP 來源位址，只能回傳固定值。
 */
export function getClientIp(request: NextRequest): string {
  switch (env.trustedProxy) {
    case 'cloudflare': {
      const cfIp = request.headers.get('cf-connecting-ip')?.trim();
      return cfIp || UNKNOWN_IP;
    }
    case 'nginx': {
      const forwardedFor = request.headers.get('x-forwarded-for');
      if (!forwardedFor) {
        return UNKNOWN_IP;
      }
      const hops = forwardedFor
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean);
      return hops[hops.length - 1] ?? UNKNOWN_IP;
    }
    case 'none':
    default:
      return UNKNOWN_IP;
  }
}

/**
 * 無法取得可信來源位址時使用的位址。
 *
 * 所有這類請求會被算成同一個來源，共用一份額度與速率限制。
 * 這是刻意的保守選擇：寧可誤傷也不要漏防。
 */
const UNKNOWN_IP = '127.0.0.1';

/**
 * 取得 Cloudflare 提供的來源國別（兩碼代碼，例如 TW）。
 *
 * 這個標頭由 Cloudflare 加上，用戶端塞不進來。沒有經過 Cloudflare 時
 * 拿不到，回傳 null——寧可留空也不要填一個猜的值。
 * `XX` 是 Cloudflare 對「無法判定」的表示法，一併視為未知。
 */
export function getClientCountry(request: NextRequest): string | null {
  const raw = request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  if (!raw || raw === 'XX' || raw === 'T1') {
    return null;
  }
  return raw;
}

export interface ClientIdResult {
  clientId: string;
  /** 這個識別碼是這次請求才產生的，路由要記得呼叫 `setClientCookie`。 */
  isNew: boolean;
}

/** 從 cookie 讀出瀏覽器識別碼；沒有就產生一個新的，交由呼叫端決定是否要設回 cookie。 */
export function getOrCreateClientId(request: NextRequest): ClientIdResult {
  const existing = request.cookies.get(CLIENT_ID_COOKIE)?.value;
  if (existing) {
    return { clientId: existing, isNew: false };
  }
  return { clientId: newClientId(), isNew: true };
}

/**
 * 把瀏覽器識別碼寫回 cookie。
 *
 * `httpOnly` 設為 false：前端要能讀到這個值來顯示「換瀏覽器看不到舊紀錄」
 * 之類的提示，也可能同步存一份到 localStorage。
 */
export function setClientCookie(response: NextResponse, clientId: string): void {
  response.cookies.set(CLIENT_ID_COOKIE, clientId, {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: CLIENT_ID_MAX_AGE,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  });
}

/** 組出符合 `ApiError` 格式的錯誤回應。 */
export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  retryAfterSeconds?: number,
): NextResponse<ApiError> {
  const body: ApiError = { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
  return NextResponse.json(body, { status });
}

/**
 * 把 `checkUploadAllowed`／`checkAnalyzeAllowed` 的拒絕結果轉成 API 錯誤回應。
 *
 * 對應規則：封鎖 403、暫停與額度（含 R5 熔斷、每日次數）429、其餘（例如
 * 無法辨識來源位址）400。
 */
export function guardToError(
  result: Extract<GuardResult, { allowed: false }>,
): NextResponse<ApiError> {
  switch (result.reason) {
    case 'blocked':
      return errorResponse('blocked', result.message, 403);
    case 'suspended':
      return errorResponse('suspended', result.message, 429, result.retryAfterSeconds);
    case 'token_limit':
      return errorResponse('daily_budget_exceeded', result.message, 429);
    case 'daily_limit':
      return errorResponse('quota_exceeded', result.message, 429);
    case 'invalid_ip':
    default:
      return errorResponse('bad_request', result.message, 400);
  }
}

/** 產生一個新的隨機識別碼字串，供暫存檔案命名等用途。 */
export function newRandomId(): string {
  return randomUUID();
}
