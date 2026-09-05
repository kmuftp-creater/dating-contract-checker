/**
 * 前端呼叫後端 API 的薄封裝。
 *
 * 只放 fetch 與型別轉換：每個函式對應一支 API，回傳型別直接沿用
 * `@/lib/api-contract`。失敗一律丟出 `ApiClientError`，呼叫端用
 * `error instanceof ApiClientError` 判斷，取 `code`／`message`／
 * `retryAfterSeconds` 顯示給使用者。
 *
 * 這個檔案只在瀏覽器端執行（元件掛載後呼叫），不含任何伺服器邏輯。
 */

import type {
  AnalysisDetailResponse,
  AnalysisListResponse,
  ApiError,
  ApiErrorCode,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  CreateReportRequest,
  CreateReportResponse,
  QuotaResponse,
  ReportListResponse,
  UploadFileResponse,
} from '@/lib/api-contract';

/** API 呼叫失敗時丟出的錯誤，攜帶伺服器回傳的錯誤代碼與可重試時間。 */
export class ApiClientError extends Error {
  code: ApiErrorCode;
  retryAfterSeconds?: number;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.retryAfterSeconds = error.retryAfterSeconds;
  }
}

/** 把非 2xx 的 Response 轉成 `ApiClientError`；回應不是預期的 JSON 格式時給一個通用中文訊息。 */
async function toApiError(response: Response): Promise<ApiClientError> {
  try {
    const data = (await response.json()) as Partial<ApiError>;
    if (typeof data.code === 'string' && typeof data.message === 'string') {
      return new ApiClientError(data as ApiError);
    }
  } catch {
    // 回應本體不是合法 JSON，走下面的預設訊息。
  }
  return new ApiClientError({
    code: 'internal',
    message:
      response.status === 404
        ? '找不到指定的資源，可能已被刪除或網址有誤。'
        : '系統發生未預期的錯誤，請稍後再試。',
  });
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}

/** 今日剩餘次數與暫停狀態，以及各項上傳限制。 */
export function getQuota(): Promise<QuotaResponse> {
  return requestJson<QuotaResponse>('/api/quota');
}

/** 建立分析。 */
export function createAnalysis(payload: CreateAnalysisRequest): Promise<CreateAnalysisResponse> {
  return requestJson<CreateAnalysisResponse>('/api/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** 查單一筆分析的進度與結果。 */
export function getAnalysis(id: string): Promise<AnalysisDetailResponse> {
  return requestJson<AnalysisDetailResponse>(`/api/analyses/${encodeURIComponent(id)}`);
}

/** 歷史紀錄列表。`cursor` 帶上一頁回傳的 `nextCursor` 可取下一頁。 */
export function listAnalyses(cursor?: string | null, limit?: number): Promise<AnalysisListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return requestJson<AnalysisListResponse>(`/api/analyses${qs ? `?${qs}` : ''}`);
}

/**
 * 送出問題回報。
 *
 * 格式為 `multipart/form-data`：不手動設定 `Content-Type`，讓瀏覽器依
 * `FormData` 內容自動帶上正確的 boundary。
 */
export function createReport(payload: CreateReportRequest): Promise<CreateReportResponse> {
  const formData = new FormData();
  formData.set('category', payload.category);
  formData.set('message', payload.message);
  if (payload.contactEmail) formData.set('contactEmail', payload.contactEmail);
  if (payload.analysisId) formData.set('analysisId', payload.analysisId);
  if (payload.screenshot) formData.set('screenshot', payload.screenshot);

  return requestJson<CreateReportResponse>('/api/reports', {
    method: 'POST',
    body: formData,
  });
}

/** 我的問題回報與管理員回覆。 */
export function listReports(): Promise<ReportListResponse> {
  return requestJson<ReportListResponse>('/api/reports');
}

/** 上傳進度回呼，`percent` 為 0 到 100 的整數。 */
export type UploadProgressHandler = (percent: number) => void;

/**
 * 上傳單一檔案，回報上傳進度。
 *
 * 用 `XMLHttpRequest` 而非 `fetch`：`fetch` 目前沒有跨瀏覽器一致的上傳
 * 進度事件，`XMLHttpRequest` 的 `upload.onprogress` 是唯一可靠的做法。
 */
export function uploadFile(file: File, onProgress?: UploadProgressHandler): Promise<UploadFileResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let data: unknown;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new ApiClientError({ code: 'internal', message: '伺服器回應格式錯誤，上傳失敗。' }));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as UploadFileResponse);
        return;
      }

      const body = data as Partial<ApiError>;
      if (typeof body.code === 'string' && typeof body.message === 'string') {
        reject(new ApiClientError(body as ApiError));
      } else {
        reject(new ApiClientError({ code: 'internal', message: '上傳失敗，請稍後再試。' }));
      }
    };

    xhr.onerror = () => {
      reject(new ApiClientError({ code: 'internal', message: '網路連線發生問題，上傳失敗。' }));
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}
