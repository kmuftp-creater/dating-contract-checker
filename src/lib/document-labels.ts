import type { DocumentKind } from './types';

/**
 * 文件種類的顯示名稱與說明。
 *
 * 集中在這裡的理由：前台法規頁、後台列表、後台編輯頁都要用同一組名稱，
 * 先前是各自寫一份，只要新增一種文件就得記得改四個地方——實際上就是漏掉。
 */

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  checklist: '查核表',
  regulation: '公告全文',
  privacy: '隱私權政策',
  terms: '服務條款',
};

/** 後台列表上的一句話說明。 */
export const DOCUMENT_DESCRIPTIONS: Record<DocumentKind, string> = {
  checklist: '分析時逐項比對的清單。報告上的每一列，都對應這份表格的一個項次。',
  regulation: '判定的法源依據。報告的改善方式會引用這份公告的條文。',
  privacy: '前台 /privacy 顯示的內容。可用變數帶入目前的系統設定值。',
  terms: '前台 /terms 顯示的內容。可用變數帶入目前的系統設定值。',
};

/** 會被 AI 分析引用的兩種文件。 */
export const ANALYSIS_KINDS: DocumentKind[] = ['checklist', 'regulation'];

/** 法律聲明，只在自己的頁面顯示，不進 AI 提示詞。 */
export const LEGAL_KINDS: DocumentKind[] = ['privacy', 'terms'];

/** 後台可編輯的全部文件種類，依顯示順序排列。 */
export const ALL_DOCUMENT_KINDS: DocumentKind[] = [...ANALYSIS_KINDS, ...LEGAL_KINDS];

export function isDocumentKind(value: string): value is DocumentKind {
  return (ALL_DOCUMENT_KINDS as string[]).includes(value);
}

/**
 * 隱私權政策與服務條款可用的變數。
 *
 * 放在這裡而不是 `src/lib/legal.ts`：那個檔案標了 server-only，
 * 而後台的編輯器是用戶端元件，需要把這份清單顯示給管理員看。
 * 實際的替換邏輯仍然在 legal.ts，兩邊以這份常數為單一來源。
 */
export const LEGAL_TOKEN_HINTS: { token: string; description: string }[] = [
  { token: '{{原始檔保留天數}}', description: '上傳的原始檔案保留幾天' },
  { token: '{{結果保留天數}}', description: '分析結果保留幾天' },
  { token: '{{每日次數上限}}', description: '每位使用者每日可分析幾次' },
  { token: '{{單批檔案上限}}', description: '單次分析最多可帶幾個檔案' },
  { token: '{{暫停分鐘數}}', description: '觸發濫用規則後暫停使用幾分鐘' },
  {
    token: '{{檔案處理方式}}',
    description: '自動產生整句話：說明使用者上傳的檔案會被怎麼處理',
  },
  {
    token: '{{營運者名稱}}',
    description: '營運本服務的單位名稱，由環境變數 OPERATOR_NAME 提供',
  },
];
