import 'server-only';

import { LEGAL_TOKEN_HINTS } from '@/lib/document-labels';
import { describeFileHandling } from '@/lib/email/hooks';
import { getSetting } from '@/lib/settings';
import type { DocumentKind } from '@/lib/types';

/**
 * 隱私權政策與服務條款的內容組裝。
 *
 * 這兩份文件由管理員在後台編輯（與法規文件共用同一套版本管理），但其中
 * 有些內容必須與系統實際設定一致，例如保留天數、每日次數上限、上傳的
 * 檔案會被怎麼處理。若讓管理員手寫這些，只要後台一改設定，條款就變成
 * 錯的——而隱私權政策寫錯比沒寫更糟。
 *
 * 解法是在 markdown 裡放變數，顯示時才代入目前的設定值。管理員照樣能改
 * 文字，數字則永遠正確。
 */


/**
 * 營運這個服務的單位名稱。
 *
 * 隱私權政策與服務條款都要寫「本服務由誰營運」。這個名稱**不能寫死在
 * 初始文件裡**：營運這套服務的是部署它的單位，條款上寫著別的名字，
 * 對使用者是錯誤資訊，而那是寫在法律文件上的錯誤資訊。
 *
 * 沒設定時退回一個中性說法，讓部署者一看就知道要改。
 */
const OPERATOR_NAME = process.env.OPERATOR_NAME?.trim() || '本服務的營運單位';

/**
 * 把 markdown 裡的變數換成目前的設定值。
 *
 * 未知的變數原樣保留，不要吃掉：管理員打錯字時應該在畫面上看得出來，
 * 而不是變成一段消失的文字。
 */
export async function renderLegalMarkdown(markdown: string): Promise<string> {
  const [retention, rules, fileHandling] = await Promise.all([
    getSetting('retention'),
    getSetting('abuse_rules'),
    describeFileHandling(),
  ]);

  const values: Record<string, string> = {
    '{{原始檔保留天數}}': String(retention.rawFileDays),
    '{{結果保留天數}}': String(retention.analysisResultDays),
    '{{每日次數上限}}': String(rules.dailyAnalysisLimit),
    '{{單批檔案上限}}': String(rules.maxFilesPerBatch),
    '{{暫停分鐘數}}': String(Math.round(rules.suspendDurationSeconds / 60)),
    '{{檔案處理方式}}': fileHandling,
    '{{營運者名稱}}': OPERATOR_NAME,
  };

  // 以 LEGAL_TOKEN_HINTS 為單一來源核對：清單上有、這裡沒給值的變數，
  // 代表兩邊不同步，寧可在開發時就炸掉也不要默默漏替換。
  for (const hint of LEGAL_TOKEN_HINTS) {
    if (!(hint.token in values)) {
      throw new Error(`變數 ${hint.token} 已列在說明清單中，但沒有對應的取值邏輯。`);
    }
  }

  let output = markdown;
  for (const [token, value] of Object.entries(values)) {
    // 用 split/join 而不是 replace：replace 的第二個參數是字串時會解析
    // `$&`、`$$` 這類替換樣式，而條款內容裡出現金額或特殊符號並非不可能。
    output = output.split(token).join(value);
  }
  return output;
}

/** 判斷某個文件種類是否為法律聲明（隱私權政策、服務條款）。 */
export function isLegalKind(kind: DocumentKind): boolean {
  return kind === 'privacy' || kind === 'terms';
}
