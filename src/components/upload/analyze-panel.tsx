'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';

import type { AnalysisMode } from '@/lib/types';

/**
 * 貼上文字、分析模式切換、開始分析按鈕。
 *
 * 這個元件不呼叫任何 API，純粹接收 `src/app/page.tsx` 準備好的狀態與
 * callback，方便把「送出前的檢查邏輯」（額度、暫停、檔案數）留在頁面層
 * 統一處理。
 */

const MODE_DESCRIPTION: Record<AnalysisMode, string> = {
  merged: '多個檔案將視為同一份合約的不同頁面或附件，合併產出一份檢核報告。',
  separate: '每個檔案各自視為一份合約，各自產出一份檢核報告（各扣一次今日次數）。',
};

export interface AnalyzePanelProps {
  pastedText: string;
  onPastedTextChange: (value: string) => void;
  maxPastedTextChars: number | null;

  mode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;

  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;

  /** 暫停或額度用盡時，API 回傳的中文說明（已含可重試時間）。 */
  blockedMessage: string | null;
  /** 送出分析失敗時的錯誤訊息（例如超過額度、伺服器錯誤）。 */
  submitError: string | null;
  /**
   * 偵測到上傳內容不是交友媒合服務契約時，API 回傳的中文說明
   * （已含第幾次、繼續上傳的後果、如何申訴）。這個訊息比一般錯誤重要，
   * 用獨立的警示區塊顯示，不與 `submitError` 共用同一行小字。
   */
  offTopicMessage: string | null;
}

export function AnalyzePanel({
  pastedText,
  onPastedTextChange,
  maxPastedTextChars,
  mode,
  onModeChange,
  canSubmit,
  submitting,
  onSubmit,
  blockedMessage,
  submitError,
  offTopicMessage,
}: AnalyzePanelProps) {
  const overLimit = maxPastedTextChars !== null && pastedText.length > maxPastedTextChars;

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="pasted-text" className="text-sm font-medium text-ink">
          或直接貼上合約文字
        </label>
        <textarea
          id="pasted-text"
          value={pastedText}
          onChange={(event) => onPastedTextChange(event.target.value)}
          rows={6}
          placeholder="可直接貼上合約全文，視為一個檔案，一併計入次數。"
          className="mt-2 w-full rounded-(--radius-control) border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
        />
        <p className={`mt-1 text-right text-xs ${overLimit ? 'text-danger' : 'text-ink-muted'}`}>
          {pastedText.length.toLocaleString('zh-Hant-TW')}
          {' / '}
          {maxPastedTextChars !== null ? maxPastedTextChars.toLocaleString('zh-Hant-TW') : '－'} 字
        </p>
      </div>

      <div>
        <span className="text-sm font-medium text-ink">分析模式</span>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="分析模式">
          {(
            [
              { value: 'merged' as const, label: '合併為一份合約' },
              { value: 'separate' as const, label: '各檔獨立分析' },
            ]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              onClick={() => onModeChange(option.value)}
              className={`rounded-(--radius-control) border px-3 py-1.5 text-sm transition-colors ${
                mode === option.value
                  ? 'border-brand bg-brand text-white'
                  : 'border-hairline text-ink-muted hover:border-brand hover:text-brand'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">{MODE_DESCRIPTION[mode]}</p>
      </div>

      {offTopicMessage && (
        <div className="flex gap-3 rounded-(--radius-control) border-2 border-warn bg-warn/10 p-4 text-sm text-ink">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <div>
            <p className="font-semibold text-warn">偵測到非目標文件</p>
            <p className="mt-1">{offTopicMessage}</p>
          </div>
        </div>
      )}

      {blockedMessage && (
        <p className="rounded-(--radius-control) border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
          {blockedMessage}
        </p>
      )}

      {submitError && (
        <p className="rounded-(--radius-control) border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
          {submitError}
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="flex items-center justify-center gap-2 rounded-(--radius-control) bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {submitting ? '送出中…' : '開始分析'}
      </button>
    </div>
  );
}
