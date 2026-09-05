'use client';

import { ImagePlus, Loader2, X, ZoomIn } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Lightbox } from '@/components/lightbox';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import type { AnalysisListItem, QuotaResponse, ReportListItem } from '@/lib/api-contract';
import { ApiClientError, createReport, getQuota, listAnalyses, listReports } from '@/lib/client/api';
import type { ReportCategory, ReportStatus } from '@/lib/types';

/** 問題回報表單，與同一瀏覽器過去送出的回報清單。 */

const CATEGORY_OPTIONS: { value: ReportCategory; label: string }[] = [
  { value: 'wrong_result', label: '分析結果有誤' },
  { value: 'upload_failed', label: '上傳失敗' },
  { value: 'regulation_error', label: '法規內容錯誤' },
  { value: 'other', label: '其他' },
];

const CATEGORY_LABEL: Record<ReportCategory, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((option) => [option.value, option.label]),
) as Record<ReportCategory, string>;

const STATUS_LABEL: Record<ReportStatus, string> = {
  open: '未處理',
  replied: '已回覆',
  closed: '已結案',
};

const STATUS_COLOR: Record<ReportStatus, string> = {
  open: 'text-ink-muted',
  replied: 'text-ok',
  closed: 'text-ink-muted',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReportPage() {
  const [category, setCategory] = useState<ReportCategory>('wrong_result');
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [analyses, setAnalyses] = useState<AnalysisListItem[]>([]);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);

  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [openReportId, setOpenReportId] = useState<string | null>(null);

  /**
   * 送出新回報後手動重新整理清單用，可以放心在效果外的事件處理常式裡
   * 同步呼叫 `setReportsLoading(true)`。
   */
  const refreshReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const data = await listReports();
      setReports(data.items);
      setReportsError(null);
    } catch (error) {
      setReportsError(error instanceof ApiClientError ? error.message : '讀取我的回報時發生錯誤。');
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReports() {
      try {
        const data = await listReports();
        if (cancelled) return;
        setReports(data.items);
        setReportsError(null);
      } catch (error) {
        if (cancelled) return;
        setReportsError(error instanceof ApiClientError ? error.message : '讀取我的回報時發生錯誤。');
      } finally {
        if (!cancelled) setReportsLoading(false);
      }
    }

    async function loadAnalyses() {
      try {
        const data = await listAnalyses();
        if (!cancelled) setAnalyses(data.items);
      } catch {
        // 關聯分析清單載入失敗不影響送出回報，選單維持空白即可。
      }
    }

    async function loadQuota() {
      try {
        const data = await getQuota();
        if (!cancelled) setQuota(data);
      } catch {
        // 讀取失敗時維持 null，改用伺服器端驗證把關，不阻擋操作。
      }
    }

    void loadReports();
    void loadAnalyses();
    void loadQuota();

    return () => {
      cancelled = true;
    };
  }, []);

  // 截圖的預覽網址由選取的檔案直接推導，不需要另外一份狀態；換一張圖片
  // 或離開頁面時，用一個只負責釋放資源、不呼叫 setState 的效果把前一個
  // objectURL 收掉，避免記憶體洩漏。
  const screenshotPreview = useMemo(
    () => (screenshot ? URL.createObjectURL(screenshot) : null),
    [screenshot],
  );

  useEffect(() => {
    if (!screenshotPreview) {
      return;
    }
    return () => {
      URL.revokeObjectURL(screenshotPreview);
    };
  }, [screenshotPreview]);

  const handleScreenshotChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }

      if (!file.type.startsWith('image/')) {
        setScreenshotError('截圖僅接受圖片格式。');
        return;
      }

      const maxBytes = quota?.maxImageBytes ?? null;
      if (maxBytes !== null && file.size > maxBytes) {
        setScreenshotError(`截圖大小超過上限（上限 ${formatMb(maxBytes)}）。`);
        return;
      }

      setScreenshotError(null);
      setScreenshot(file);
    },
    [quota],
  );

  const handleRemoveScreenshot = useCallback(() => {
    setScreenshot(null);
    setScreenshotError(null);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (message.trim().length === 0) {
        setSubmitError('請填寫問題描述。');
        return;
      }
      if (screenshotError) {
        setSubmitError('請先移除或更換不符合規定的截圖。');
        return;
      }

      setSubmitting(true);
      setSubmitError(null);
      try {
        await createReport({
          category,
          message: message.trim(),
          contactEmail: contactEmail.trim() ? contactEmail.trim() : undefined,
          analysisId: analysisId ? analysisId : undefined,
          screenshot: screenshot ?? undefined,
        });
        setSubmitted(true);
        setMessage('');
        setContactEmail('');
        setAnalysisId('');
        setScreenshot(null);
        await refreshReports();
      } catch (error) {
        setSubmitError(error instanceof ApiClientError ? error.message : '送出失敗，請稍後再試。');
      } finally {
        setSubmitting(false);
      }
    },
    [category, message, contactEmail, analysisId, screenshot, screenshotError, refreshReports],
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-10 px-4 py-10">
        <div>
          <h1 className="text-3xl font-semibold">問題回報</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            分析結果有誤、上傳失敗，或發現法規內容有問題，都可以透過這裡回報。留下聯絡信箱可以在管理員回覆後收到通知信。
          </p>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="card space-y-5 p-6">
          {submitted && (
            <p className="rounded-(--radius-control) border border-ok/50 bg-ok/10 p-3 text-sm text-ok">
              回報已送出，謝謝提供的資訊。管理員回覆後會顯示在下方「我的回報」。
            </p>
          )}

          <div>
            <span className="text-sm font-medium text-ink">問題類型</span>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="問題類型">
              {CATEGORY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={category === option.value}
                  onClick={() => setCategory(option.value)}
                  className={`rounded-(--radius-control) border px-3 py-1.5 text-sm transition-colors ${
                    category === option.value
                      ? 'border-brand bg-brand text-white'
                      : 'border-hairline text-ink-muted hover:border-brand hover:text-brand'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="report-message" className="text-sm font-medium text-ink">
              問題描述
            </label>
            <textarea
              id="report-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              required
              placeholder="請描述遇到的問題，例如是哪一筆分析、哪一個查核項目的判定有疑問。"
              className="mt-2 w-full rounded-(--radius-control) border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="report-email" className="text-sm font-medium text-ink">
                聯絡信箱（選填）
              </label>
              <input
                id="report-email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="name@example.com"
                className="mt-2 w-full rounded-(--radius-control) border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="report-analysis" className="text-sm font-medium text-ink">
                關聯的分析（選填）
              </label>
              <select
                id="report-analysis"
                value={analysisId}
                onChange={(event) => setAnalysisId(event.target.value)}
                className="mt-2 w-full rounded-(--radius-control) border border-hairline bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="">不指定</option>
                {analyses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatDateTime(item.createdAt)}
                    {item.fileNames.length > 0 ? item.fileNames.join('、') : '（貼上的文字）'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="text-sm font-medium text-ink">附上截圖（選填）</span>

            {!screenshot && (
              <label
                htmlFor="report-screenshot"
                className="mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-(--radius-control) border border-hairline px-3 py-2 text-sm text-ink-muted transition-colors hover:border-brand hover:text-brand"
              >
                <ImagePlus className="size-4" aria-hidden />
                選擇圖片
              </label>
            )}
            <input
              id="report-screenshot"
              type="file"
              accept="image/*"
              onChange={handleScreenshotChange}
              className="hidden"
            />

            {screenshot && screenshotPreview && (
              <div className="mt-2 flex items-center gap-3">
                <div className="relative size-20 shrink-0 overflow-hidden rounded-(--radius-control) border border-hairline">
                  <Image src={screenshotPreview} alt="截圖預覽" fill unoptimized className="object-cover" />
                </div>
                <div className="text-sm">
                  <p className="text-ink">{screenshot.name}</p>
                  <button
                    type="button"
                    onClick={handleRemoveScreenshot}
                    className="mt-1 inline-flex items-center gap-1 text-danger hover:underline"
                  >
                    <X className="size-3.5" aria-hidden />
                    移除
                  </button>
                </div>
              </div>
            )}

            {screenshotError && <p className="mt-2 text-sm text-danger">{screenshotError}</p>}
            {!screenshotError && quota && (
              <p className="mt-2 text-xs text-ink-muted">只接受圖片，單檔上限 {formatMb(quota.maxImageBytes)}。</p>
            )}
          </div>

          {submitError && (
            <p className="rounded-(--radius-control) border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-2 rounded-(--radius-control) bg-brand px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {submitting ? '送出中…' : '送出回報'}
          </button>
        </form>

        <div>
          <h2 className="text-xl font-semibold text-ink">我的回報</h2>

          {reportsLoading && (
            <div className="card mt-4 flex items-center gap-2 p-6 text-ink-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              載入中…
            </div>
          )}

          {!reportsLoading && reportsError && <p className="card mt-4 p-6 text-danger">{reportsError}</p>}

          {!reportsLoading && !reportsError && reports.length === 0 && (
            <p className="card mt-4 p-6 text-ink-muted">這個瀏覽器還沒有送出過回報。</p>
          )}

          {!reportsLoading && reports.length > 0 && (
            <ul className="mt-4 space-y-3">
              {reports.map((item) => (
                <li key={item.id} className="card space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{CATEGORY_LABEL[item.category]}</span>
                    <span className="flex items-center gap-3 text-xs text-ink-muted">
                      {formatDateTime(item.createdAt)}
                      <span className={`font-medium ${STATUS_COLOR[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                    </span>
                  </div>
                  <p className="text-sm text-ink">{item.message}</p>
                  {item.hasScreenshot && (
                    <button
                      type="button"
                      onClick={() => setOpenReportId(item.id)}
                      aria-label="放大檢視截圖"
                      className="group relative block size-20 overflow-hidden rounded-(--radius-control) border border-hairline"
                    >
                      <Image
                        src={`/api/reports/${item.id}/screenshot`}
                        alt="回報截圖縮圖"
                        fill
                        unoptimized
                        className="object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                        <ZoomIn className="size-4" aria-hidden />
                      </span>
                    </button>
                  )}
                  {item.replies.length > 0 && (
                    <div className="space-y-2 border-t border-hairline pt-2">
                      {item.replies.map((reply, index) => (
                        <div key={index} className="rounded-(--radius-control) bg-canvas p-3 text-sm">
                          <p className="text-ink">{reply.body}</p>
                          <p className="mt-1 text-xs text-ink-muted">{formatDateTime(reply.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <Lightbox
        src={openReportId ? `/api/reports/${openReportId}/screenshot` : null}
        alt="問題回報截圖"
        onClose={() => setOpenReportId(null)}
      />

      <SiteFooter />
    </div>
  );
}
