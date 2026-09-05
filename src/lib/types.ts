/**
 * 全專案共用的領域型別。
 *
 * 這個檔案是各模組之間的契約：檔案抽取、AI 分析、資料存取、前後台介面
 * 都以此處的型別溝通。修改前請確認呼叫端。
 */

/** 部署版本。決定掛上哪些擴充，見 `src/lib/email/hooks.ts`。 */
export type Edition = 'private' | 'public';

/** 分析模式。 */
export type AnalysisMode =
  /** 多個檔案視為同一份合約的不同頁面或附件，產出一份報告。 */
  | 'merged'
  /** 每個檔案各自是一份合約，各產出一份報告。 */
  | 'separate';

/** 分析狀態。 */
export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed';

/** 單一查核項目的判定結果。 */
export type CheckStatus =
  /** 符合。 */
  | 'pass'
  /** 不符合。 */
  | 'fail'
  /** 建議修正：形式上有寫，但寫法不足。 */
  | 'fix'
  /** 不適用：合約未涉及該服務。 */
  | 'na';

/** 法規文件種類。 */
export type DocumentKind =
  /** 115 年交友媒合服務定型化契約查核表。 */
  | 'checklist'
  /** 交友媒合服務定型化契約應記載及不得記載事項（公告全文）。 */
  | 'regulation'
  /** 隱私權政策。 */
  | 'privacy'
  /** 服務條款。 */
  | 'terms';

/**
 * 會被 AI 分析引用的文件種類。
 *
 * 隱私權政策與服務條款雖然共用同一套版本管理，但它們不是判定依據，
 * 不該被送進提示詞，也不該出現在前台的「法規文件」頁。
 */
export const ANALYSIS_DOCUMENT_KINDS = ['checklist', 'regulation'] as const;

/** 屬於法律聲明、只在自己的頁面顯示的文件種類。 */
export const LEGAL_DOCUMENT_KINDS = ['privacy', 'terms'] as const;

/** IP 狀態。 */
export type IpStatus = 'normal' | 'suspended' | 'blocked';

/** 問題回報分類。 */
export type ReportCategory =
  | 'wrong_result'
  | 'upload_failed'
  | 'regulation_error'
  | 'other';

/** 問題回報處理狀態。 */
export type ReportStatus = 'open' | 'replied' | 'closed';

/** 支援的上傳檔案類別。 */
export type FileCategory = 'image' | 'pdf' | 'word' | 'excel' | 'text';

/** 抽取方式：直接讀出文字，或轉成圖片交給模型辨識。 */
export type ExtractMethod = 'text' | 'ocr';

/**
 * 檔案抽取的產出。
 *
 * text 與 images 至少有一個非空。掃描檔 PDF 與相片會走 images，
 * 其餘走 text。
 */
export interface ExtractResult {
  /** 抽出的純文字。無文字內容時為空字串。 */
  text: string;
  /**
   * 要交給模型辨識的圖片，已轉為 JPEG。
   * 走 text 路徑時為空陣列。
   */
  images: ExtractedImage[];
  /** 實際採用的抽取方式。 */
  method: ExtractMethod;
  /** PDF 或 Excel 的頁數、工作表數。其餘為 1。 */
  pageCount: number;
  /** 抽取過程的提醒，例如「第 3 頁無文字層，改用影像辨識」。 */
  notes: string[];
}

/** 準備送給模型的單張圖片。 */
export interface ExtractedImage {
  /** JPEG 位元組內容。 */
  data: Buffer;
  /** 一律為 image/jpeg。 */
  mime: 'image/jpeg';
  /** 來源說明，例如「第 2 頁」或原始檔名。 */
  label: string;
  width: number;
  height: number;
}

/** 封存用的檔案：圖片轉 WebP，其餘原樣。 */
export interface ArchiveResult {
  data: Buffer;
  /** 例如 image/webp、application/pdf。 */
  mime: string;
  /** 封存後的副檔名，含點號，例如 .webp。 */
  extension: string;
  /** 是否經過轉檔。 */
  converted: boolean;
}

/** AI 回傳的單一查核項目。 */
export interface CheckItem {
  /** 對應查核表的項次，例如 "1"、"2-1"、"B-3"。 */
  id: string;
  /** 查核項目名稱。 */
  title: string;
  status: CheckStatus;
  /** 合約中對應內容的摘要或原文片段。找不到時為空字串。 */
  evidence: string;
  /** 改善方式。僅 fail 與 fix 有值，其餘為空字串。限兩句。 */
  fix: string;
}

/** 一份合約的完整檢核結果。 */
export interface AnalysisResult {
  items: CheckItem[];
  summary: {
    pass: number;
    fail: number;
    fix: number;
    na: number;
  };
  /** 無法判定的部分，例如影像模糊。沒有則為空字串。 */
  notes: string;
}

/** 呼叫 AI 閘道後的回傳，含用量。 */
export interface AnalysisRun {
  result: AnalysisResult;
  usage: TokenUsage;
  /** 實際使用的模型別名。 */
  model: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** 系統設定的鍵。值的型別見 settings-schema.ts。 */
export type SettingKey =
  | 'ai'
  | 'analysis_hook'
  | 'abuse_rules'
  | 'retention'
  | 'smtp';
