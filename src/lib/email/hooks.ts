import 'server-only';

import type { EmailJobRow } from './common';

/**
 * 這份部署的擴充點。
 *
 * 系統核心只做一件事：把契約分析完、把結果存起來、必要時回覆問題回報。
 * 除此之外要不要做別的（分析完成後的額外處理、額外的信件類型、後台的
 * 額外設定頁），由這個檔案宣告。
 *
 * **這份部署沒有掛任何擴充。** 下面的宣告都是空的：分析完成後不會觸發
 * 任何額外動作，寄信佇列只處理問題回報的回覆通知，後台也沒有額外的設定頁。
 *
 * 要加上自己的處理（例如分析完成後通知內部窗口），就在這裡實作。
 */

/**
 * 一筆分析成功完成之後要做的事。
 *
 * 由 `src/lib/worker/queue.ts` 在 `markDone` 之後呼叫。
 */
export async function onAnalysisCompleted(_analysisId: string): Promise<void> {
  // 沒有要做的事。
}

/**
 * 核心之外的寄信工作處理器，鍵為 `email_jobs.type`。
 *
 * `processNextEmailJob` 取到不認得的工作類型時會來這裡找；找不到就讓那筆
 * 工作明確失敗，而不是安靜地標記成已寄出。
 */
export const EXTRA_EMAIL_HANDLERS: Record<string, (job: EmailJobRow) => Promise<void>> = {};

/** 後台導覽要額外加上的項目。 */
export const EXTRA_ADMIN_NAV: { href: string; label: string }[] = [];

/**
 * 隱私權政策裡「上傳的檔案會被怎麼處理」那一段。
 *
 * 這句話必須與這份部署的實際行為一致。這份部署不對上傳的檔案做任何
 * 額外處理，所以就是這一句。
 */
export async function describeFileHandling(): Promise<string> {
  return '您上傳的檔案只存在本服務的伺服器上，不會寄送到任何信箱。';
}
