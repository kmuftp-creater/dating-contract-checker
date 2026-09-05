/**
 * 前台 API 的請求與回應格式。
 *
 * 這個檔案是前端與後端之間的契約。兩邊都從這裡匯入型別，
 * 任何一邊改了格式，另一邊會在型別檢查時就發現，而不是等到執行時才壞掉。
 *
 * 命名慣例：`XxxRequest` 是送出去的內容，`XxxResponse` 是成功時的回應。
 * 失敗時一律回傳 `ApiError`，HTTP 狀態碼另外標示。
 */

import type {
  AnalysisMode,
  AnalysisResult,
  AnalysisStatus,
  ExtractMethod,
  FileCategory,
  ReportCategory,
  ReportStatus,
} from './types';

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

/**
 * 錯誤回應。
 *
 * `message` 一律是可以直接顯示給使用者的繁體中文句子。
 * `code` 供前端做特別處理（例如被暫停時要顯示倒數）。
 */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** 被暫停或超過速率限制時，多久之後可以再試（秒）。 */
  retryAfterSeconds?: number;
}

export type ApiErrorCode =
  /** 來源已被封鎖。 */
  | 'blocked'
  /** 短時間大量操作，暫停使用中。 */
  | 'suspended'
  /** 今日分析次數已用完。 */
  | 'quota_exceeded'
  /** 全站當日 AI 用量已達上限。 */
  | 'daily_budget_exceeded'
  /** 檔案格式不支援。 */
  | 'unsupported_file'
  /** 檔案太大。 */
  | 'file_too_large'
  /** 一次帶太多檔案。 */
  | 'too_many_files'
  /** 偵測到上傳內容不是交友媒合服務契約（2026-09-05 需求）。 */
  | 'off_topic_document'
  /** 請求內容有誤。 */
  | 'bad_request'
  /** 找不到指定資源。 */
  | 'not_found'
  /** AI 閘道尚未設定。 */
  | 'ai_not_configured'
  /** 伺服器內部錯誤。 */
  | 'internal';

/** 存放瀏覽器識別碼的 cookie 名稱。前後端都用這個常數，不要各寫各的。 */
export const CLIENT_ID_COOKIE = 'ccid';

/** 瀏覽器識別碼的有效期（秒）。假設一年。 */
export const CLIENT_ID_MAX_AGE = 365 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// POST /api/files：上傳單一檔案
// ---------------------------------------------------------------------------

/**
 * 請求為 multipart/form-data，欄位名稱 `file`，一次一個檔案。
 *
 * 為什麼一次一個：Cloudflare 免費方案對單一請求主體有 100 MB 上限，
 * 20 個檔案包成一包會超過；分開送也讓前端能逐檔顯示進度。
 */
export interface UploadFileResponse {
  fileId: string;
  /** 使用者上傳時的原始檔名。 */
  name: string;
  /** 原始檔案大小（位元組）。 */
  size: number;
  category: FileCategory;
  /** 這個檔案是抽出文字，還是要交給模型辨識影像。 */
  extractMethod: ExtractMethod;
  /** PDF 頁數或 Excel 工作表數，其餘為 1。 */
  pageCount: number;
  /** 抽取過程的提醒，例如「第 3 頁無文字層，改用影像辨識」。 */
  notes: string[];
}

// ---------------------------------------------------------------------------
// POST /api/analyses：建立分析
// ---------------------------------------------------------------------------

export interface CreateAnalysisRequest {
  /** 先前上傳成功的檔案 id。與 pastedText 至少要有一個非空。 */
  fileIds: string[];
  /** 直接貼上的合約文字。視為一個檔案，一樣計入次數。 */
  pastedText?: string;
  /**
   * merged：多個檔案是同一份合約的不同頁面或附件，產出一份報告。
   * separate：每個檔案各自是一份合約，各產出一份報告。
   */
  mode: AnalysisMode;
}

export interface CreateAnalysisResponse {
  /** 建立的分析 id。mode 為 separate 時會有多筆。 */
  analysisIds: string[];
  /** 這次總共扣掉幾次額度。 */
  consumed: number;
  /** 扣除後今日還剩幾次。 */
  remaining: number;
}

// ---------------------------------------------------------------------------
// GET /api/analyses/[id]：查進度與結果
// ---------------------------------------------------------------------------

export interface AnalysisDetailResponse {
  id: string;
  status: AnalysisStatus;
  mode: AnalysisMode;
  createdAt: string;
  finishedAt: string | null;
  files: AnalysisFileSummary[];
  /** 進度。status 為 running 時有意義。 */
  progress: { current: number; total: number };
  /** status 為 done 時才有值。 */
  result: AnalysisResult | null;
  /** status 為 failed 時才有值，是給使用者看的繁體中文說明。 */
  error: string | null;
  /** 這筆分析依據的法規版本，讓使用者知道結果是照哪一版判的。 */
  checklistVersion: number | null;
  regulationVersion: number | null;
}

export interface AnalysisFileSummary {
  id: string;
  name: string;
  size: number;
  category: FileCategory;
  extractMethod: ExtractMethod;
  pageCount: number;
}

// ---------------------------------------------------------------------------
// GET /api/analyses：歷史紀錄
// ---------------------------------------------------------------------------

export interface AnalysisListResponse {
  items: AnalysisListItem[];
  /** 還有更多時，帶這個值回來查下一頁。 */
  nextCursor: string | null;
}

export interface AnalysisListItem {
  id: string;
  status: AnalysisStatus;
  mode: AnalysisMode;
  createdAt: string;
  /** 檔案名稱清單，供列表顯示。 */
  fileNames: string[];
  /** status 為 done 時的統計，其餘為 null。 */
  summary: AnalysisResult['summary'] | null;
}

// ---------------------------------------------------------------------------
// GET /api/quota：今日剩餘次數與暫停狀態
// ---------------------------------------------------------------------------

export interface QuotaResponse {
  /** 今日已用次數，取兩把尺中較大者。 */
  used: number;
  /** 今日上限。 */
  limit: number;
  /** 今日剩餘次數。 */
  remaining: number;
  /** 是否處於暫停狀態。 */
  suspended: boolean;
  /** 暫停時的剩餘秒數。 */
  retryAfterSeconds: number | null;
  /** 暫停或額度用盡時，直接顯示給使用者的繁體中文句子。 */
  message: string | null;
  /** 單批最多可上傳幾個檔案，讓前端能在選檔時就擋下。 */
  maxFilesPerBatch: number;
  /** 圖片與其他檔案的大小上限（位元組）。 */
  maxImageBytes: number;
  maxDocumentBytes: number;
  /** 貼上文字的長度上限（字元）。 */
  maxPastedTextChars: number;
}

// ---------------------------------------------------------------------------
// 問題回報
// ---------------------------------------------------------------------------

/**
 * 請求為 multipart/form-data（而非 JSON），欄位與此介面同名。
 *
 * 為什麼不沿用 `POST /api/files`：那支上傳會計入分析用的暫存檔案與
 * 額度，問題回報的截圖只是附件，兩者生命週期完全不同，因此
 * `POST /api/reports` 自己接收 `multipart/form-data`，不經過檔案上傳 API。
 */
export interface CreateReportRequest {
  category: ReportCategory;
  message: string;
  /** 選填的聯絡信箱。留空表示不需要回覆通知。 */
  contactEmail?: string;
  /** 選填，關聯到哪一筆分析。 */
  analysisId?: string;
  /** 選填的截圖，欄位名稱固定為 `screenshot`。只接受圖片，一次一張。 */
  screenshot?: File;
}

export interface CreateReportResponse {
  reportId: string;
}

export interface ReportListResponse {
  items: ReportListItem[];
}

export interface ReportListItem {
  id: string;
  category: ReportCategory;
  message: string;
  status: ReportStatus;
  createdAt: string;
  /** 這筆回報是否附了截圖，附了才顯示縮圖並可請求 `GET /api/reports/[id]/screenshot`。 */
  hasScreenshot: boolean;
  replies: { body: string; createdAt: string }[];
}
