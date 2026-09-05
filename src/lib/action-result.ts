/**
 * 伺服器動作的回傳格式與包裝函式。
 *
 * 為什麼不讓動作直接拋錯：Next.js 在正式環境會把伺服器動作拋出的錯誤訊息
 * 遮蔽掉（避免洩漏內部資訊），用戶端只會收到一個泛用錯誤，畫面上就變成
 * 「Minified React error #...」這種對使用者毫無意義的字串。
 *
 * 開發模式看不出這個問題，因為開發模式不遮蔽訊息——這正是它能一路上線的原因。
 *
 * 所以**預期內的錯誤**（版本號重複、日期格式錯、網址不合法）一律用回傳值
 * 傳遞，讓用戶端拿得到原本的中文說明；只有真正非預期的狀況才拋出。
 *
 * 這個檔案刻意不匯入任何 Next.js 的東西，才能被驗證腳本直接載入測試。
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * 執行動作並把預期內的錯誤轉成回傳值。
 *
 * 這裡刻意攔下所有 Error：資料層丟出的驗證錯誤（例如「第 1 版已經存在」）
 * 都是寫給使用者看的中文訊息，攔下來原樣回傳才有意義。
 * 非預期的錯誤同樣會被攔下，但會先寫進伺服器紀錄供排查。
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[後台動作] 失敗：${message}`);
    return { ok: false, message };
  }
}

/**
 * 把日期輸入框的值（YYYY-MM-DD）轉成 Date。
 *
 * 用當地時間的中午當基準點，避免時區換算讓日期跳到前一天。
 * 空字串代表「不指定」，回傳 undefined 交由呼叫端決定預設行為。
 */
export function parsePublishedAtDate(value: string | undefined): Date | undefined {
  if (!value || value.trim() === '') {
    return undefined;
  }
  const parsed = new Date(`${value.trim()}T12:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`生效日期格式不正確：${value}`);
  }
  return parsed;
}
