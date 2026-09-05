import 'server-only';

/**
 * 出口 IP 查詢：後台「執行診斷」按鈕專用。
 *
 * 地區封鎖、防火牆、代理設定錯誤，症狀在管理員眼中都是「就是連不上」，
 * 看不出原因。出口 IP 一比對就能分辨：例如主機被 Gemini 判定的地區封鎖，
 * 光看「連線失敗」看不出來，但出口 IP 一查就知道問題出在哪一段路由。
 *
 * 只在管理員主動按下「執行診斷」時才會呼叫這支函式（見
 * `src/app/admincenter/actions/settings.ts` 的 `diagnoseGatewayAction`、
 * `diagnoseGroqAction`），不會出現在頁面載入或任何自動流程中。
 */
export const EGRESS_IP_CHECK_URL = 'https://api.ipify.org';

const EGRESS_IP_TIMEOUT_MS = 5000;

/**
 * 查詢本機（伺服器）目前對外請求時使用的 IP。
 *
 * `url` 預設為上面的常數，開放帶入其他位址只是為了讓驗證腳本能代入本機
 * 假伺服器或不可達位址測試逾時／連線失敗路徑，正式流程一律使用預設值。
 *
 * 查不到（逾時、連線失敗、回應非預期格式）一律回傳「無法取得」，不拋出
 * 例外——這是一個對外部服務的次要查詢，不該讓整個診斷因此失敗。
 */
export async function getEgressIp(url: string = EGRESS_IP_CHECK_URL): Promise<string> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(EGRESS_IP_TIMEOUT_MS),
    });
    if (!response.ok) {
      return '無法取得';
    }
    const text = (await response.text()).trim();
    // api.ipify.org 純文字端點只會回一個 IP 位址字串；回應內容明顯不像
    // IP（例如逾時代理回傳的錯誤頁面 HTML）時，視同查不到。
    if (text === '' || text.length > 64) {
      return '無法取得';
    }
    return text;
  } catch {
    return '無法取得';
  }
}
