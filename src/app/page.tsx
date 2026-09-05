'use client';

import { useCallback, useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { UsageGuide } from '@/components/usage-guide';
import { AnalyzePanel } from '@/components/upload/analyze-panel';
import { Dropzone } from '@/components/upload/dropzone';
import { FileList, type UploadItem } from '@/components/upload/file-list';
import type { QuotaResponse } from '@/lib/api-contract';
import { ApiClientError, createAnalysis, getQuota, uploadFile } from '@/lib/client/api';
import type { AnalysisMode } from '@/lib/types';

/**
 * 主頁：上傳、貼上文字、分析模式切換，送出後導向結果頁
 * （單筆分析導向 `/history/[id]`，多筆導向 `/history`）。
 */

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function HomePage() {
  const router = useRouter();

  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [pastedText, setPastedText] = useState('');
  const [mode, setMode] = useState<AnalysisMode>('merged');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [offTopicMessage, setOffTopicMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getQuota()
      .then((data) => {
        if (!cancelled) setQuota(data);
      })
      .catch(() => {
        // 讀取失敗時維持 null，畫面顯示上限為「載入中」，不阻擋操作。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const currentCount = items.filter((item) => item.status !== 'error').length;
      const maxFiles = quota?.maxFilesPerBatch ?? Infinity;
      const allowed = files.slice(0, Math.max(maxFiles - currentCount, 0));

      if (allowed.length < files.length) {
        setSubmitError(`一次最多只能上傳 ${maxFiles} 個檔案，已超過的部分不會加入。`);
      } else {
        setSubmitError(null);
      }

      const newItems: UploadItem[] = allowed.map((file) => ({
        localId: newLocalId(),
        file,
        status: 'uploading',
        progress: 0,
      }));
      setItems((prev) => [...prev, ...newItems]);

      for (const item of newItems) {
        uploadFile(item.file, (percent) => {
          setItems((prev) =>
            prev.map((existing) => (existing.localId === item.localId ? { ...existing, progress: percent } : existing)),
          );
        })
          .then((result) => {
            setItems((prev) =>
              prev.map((existing) =>
                existing.localId === item.localId
                  ? { ...existing, status: 'done', progress: 100, result }
                  : existing,
              ),
            );
          })
          .catch((error: unknown) => {
            const message = error instanceof ApiClientError ? error.message : '上傳失敗，請稍後再試。';
            setItems((prev) =>
              prev.map((existing) =>
                existing.localId === item.localId ? { ...existing, status: 'error', error: message } : existing,
              ),
            );
          });
      }
    },
    [items, quota],
  );

  const handleRemove = useCallback((localId: string) => {
    setItems((prev) => prev.filter((item) => item.localId !== localId));
  }, []);

  const doneFileIds = items.filter((item) => item.status === 'done' && item.result).map((item) => item.result!.fileId);
  const hasUploading = items.some((item) => item.status === 'uploading');
  const trimmedText = pastedText.trim();
  const hasContent = doneFileIds.length > 0 || trimmedText.length > 0;
  const overTextLimit = quota !== null && trimmedText.length > quota.maxPastedTextChars;
  const quotaBlocked = quota !== null && (quota.suspended || quota.remaining <= 0);

  const canSubmit = hasContent && !hasUploading && !overTextLimit && !quotaBlocked;

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    setOffTopicMessage(null);
    setSubmitting(true);
    try {
      const response = await createAnalysis({
        fileIds: doneFileIds,
        pastedText: trimmedText.length > 0 ? trimmedText : undefined,
        mode,
      });
      if (response.analysisIds.length === 1) {
        router.push(`/history/${response.analysisIds[0]}`);
      } else {
        router.push('/history');
      }
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'off_topic_document') {
        // 偵測到非目標文件：訊息比一般錯誤重要，用獨立的警示區塊顯示
        // （見 `AnalyzePanel` 的 `offTopicMessage`），不與其他錯誤共用同一行小字。
        setOffTopicMessage(error.message);
      } else {
        setSubmitError(error instanceof ApiClientError ? error.message : '建立分析失敗，請稍後再試。');
      }
      setSubmitting(false);
    }
  }, [doneFileIds, trimmedText, mode, router]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-semibold">交友媒合服務契約檢核</h1>
        <p className="mt-3 max-w-2xl text-ink-muted">
          依「縣市年交友媒合服務定型化契約查核表」逐條檢查您的合約，
          指出違反規定的地方與修改方式。不需要註冊或登入。
        </p>

        <div className="mt-8">
          <UsageGuide />
        </div>

        <div className="card mt-6 space-y-6 p-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">上傳合約檔案</h2>
            <div className="mt-3">
              <Dropzone
                onFiles={handleFiles}
                disabled={quotaBlocked}
                maxFilesPerBatch={quota?.maxFilesPerBatch ?? null}
                maxImageBytes={quota?.maxImageBytes ?? null}
                maxDocumentBytes={quota?.maxDocumentBytes ?? null}
              />
              <FileList items={items} onRemove={handleRemove} />
            </div>
          </div>

          <hr className="border-hairline" />

          <AnalyzePanel
            pastedText={pastedText}
            onPastedTextChange={setPastedText}
            maxPastedTextChars={quota?.maxPastedTextChars ?? null}
            mode={mode}
            onModeChange={setMode}
            canSubmit={canSubmit}
            submitting={submitting}
            onSubmit={() => void handleSubmit()}
            blockedMessage={quotaBlocked ? (quota?.message ?? '目前無法送出分析。') : null}
            submitError={submitError}
            offTopicMessage={offTopicMessage}
          />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
