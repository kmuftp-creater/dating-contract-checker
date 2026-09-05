'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ExpandableText } from '@/components/result/expandable-text';
import { ReportActions } from '@/components/result/report-actions';
import { StatusBadge } from '@/components/result/status-badge';
import { SummaryBar } from '@/components/result/summary-bar';
import type { AnalysisDetailResponse, AnalysisFileSummary } from '@/lib/api-contract';
import { ApiClientError, getAnalysis } from '@/lib/client/api';
import type { CheckItem, ExtractMethod } from '@/lib/types';

/**
 * 分析進度與結果。
 *
 * 建立分析後（或重新打開歷史紀錄）掛載這個元件，就會開始輪詢
 * `GET /api/analyses/[id]`，狀態仍是排隊或處理中時每 2 秒查一次，
 * 進入 `done`／`failed` 後停止輪詢。
 *
 * 版面依 `參考截圖`：頂部一列統計，逐項列出查核項目、合約現況、判定、
 * 改善方式；桌面用表格，手機改為卡片（`hidden md:block` / `md:hidden`）。
 */

const POLL_MS = 2000;

const EXTRACT_METHOD_LABEL: Record<ExtractMethod, string> = {
  text: '文字抽取',
  ocr: '影像辨識',
};

const MODE_LABEL = { merged: '合併為一份合約', separate: '各檔獨立分析' } as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-Hant-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export interface ResultViewProps {
  id: string;
  /**
   * 伺服器端（Server Component）先取好的初始結果，避免第一次繪製只看到
   * 「載入中」——這對不執行前端 JavaScript 的驗證腳本尤其重要，也讓真實
   * 使用者少等一次來回。仍是排隊或處理中狀態時，掛載後照樣會開始輪詢。
   */
  initialDetail?: AnalysisDetailResponse | null;
}

export function ResultView({ id, initialDetail = null }: ResultViewProps) {
  const [detail, setDetail] = useState<AnalysisDetailResponse | null>(initialDetail);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialDetail === null);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const alreadyFinished =
    initialDetail !== null && initialDetail.status !== 'queued' && initialDetail.status !== 'running';

  useEffect(() => {
    if (alreadyFinished) {
      // 伺服器端取到的結果已經是終態，不需要再輪詢。
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const data = await getAnalysis(id);
        if (cancelled) return;
        setDetail(data);
        setErrorMessage(null);
        if (data.status === 'queued' || data.status === 'running') {
          timer = setTimeout(load, POLL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof ApiClientError ? error.message : '讀取分析結果時發生錯誤。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, alreadyFinished]);

  if (loading && !detail && !errorMessage) {
    return (
      <div className="card mt-6 flex items-center gap-2 p-6 text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        載入中…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="card mt-6 p-6">
        <p className="text-danger">查無資料：找不到這筆分析紀錄，可能已被刪除、超過保留期限，或網址有誤。</p>
        {errorMessage && <p className="mt-1 text-sm text-ink-muted">{errorMessage}</p>}
      </div>
    );
  }

  const items: CheckItem[] = detail.result?.items ?? [];
  const visibleItems = onlyIssues
    ? items.filter((item) => item.status === 'fail' || item.status === 'fix')
    : items;

  return (
    <div className="mt-6 space-y-6">
      <div className="card p-4 text-sm text-ink-muted">
        <p>
          模式：{MODE_LABEL[detail.mode]}　建立時間：{formatDateTime(detail.createdAt)}
          {detail.finishedAt && `　完成時間：${formatDateTime(detail.finishedAt)}`}
        </p>
        {(detail.checklistVersion !== null || detail.regulationVersion !== null) && (
          <p className="mt-1">
            依據版本：查核表第 {detail.checklistVersion ?? '－'} 版、公告全文第{' '}
            {detail.regulationVersion ?? '－'} 版
          </p>
        )}
        <FileSummaryList files={detail.files} />
      </div>

      {(detail.status === 'queued' || detail.status === 'running') && (
        <div className="card flex items-center gap-2 p-6 text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          分析中，共 {detail.files.length} 個檔案，請稍候（通常在數十秒內完成，本頁每 2 秒自動更新）……
        </div>
      )}

      {detail.status === 'failed' && (
        <div className="card space-y-2 border border-danger/50 p-6">
          <p className="font-medium text-danger">分析失敗</p>
          <p className="text-sm text-ink">{detail.error ?? '分析失敗，原因不明。'}</p>
          <p className="text-sm text-ink-muted">本次分析次數已退還，不計入今日使用次數。</p>
        </div>
      )}

      {detail.status === 'done' && detail.result && (
        <>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="lg:flex-1">
              <SummaryBar summary={detail.result.summary} />
            </div>
            <ReportActions
              analysisId={detail.id}
              input={{
                createdAt: detail.createdAt,
                finishedAt: detail.finishedAt,
                mode: detail.mode,
                files: detail.files,
                checklistVersion: detail.checklistVersion,
                regulationVersion: detail.regulationVersion,
                result: detail.result,
              }}
            />
          </div>

          {detail.result.notes && (
            <div className="flex gap-2 rounded-(--radius-control) border border-warn/50 bg-warn/10 p-3 text-sm text-warn">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span>{detail.result.notes}</span>
            </div>
          )}

          <label className="print-hide flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={onlyIssues}
              onChange={(event) => setOnlyIssues(event.target.checked)}
              className="size-4 rounded border-hairline"
            />
            篩選：只看不符合與建議修正
          </label>

          {/* 桌面版：表格。table-fixed 讓欄寬固定分配（不再跟著最長的一段
              文字走），儲存格文字改用 break-words 換行，正常情況不需要
              橫向捲動；overflow-x-auto 只當保險。 */}
          <div className="hidden overflow-x-auto rounded-(--radius-control) border border-hairline md:block">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[34%]" />
                <col className="w-[12%]" />
                <col className="w-[32%]" />
              </colgroup>
              <thead className="bg-canvas">
                <tr>
                  <th className="px-3 py-2 font-semibold break-words text-ink">查核項目</th>
                  <th className="px-3 py-2 font-semibold break-words text-ink">合約現況</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap text-ink">判定</th>
                  <th className="px-3 py-2 font-semibold break-words text-ink">改善方式</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id} className="border-b border-hairline align-top last:border-0">
                    <td className="px-3 py-2 break-words text-ink">
                      <span className="text-ink-muted">{item.id}．</span>
                      {item.title}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <ExpandableText text={item.evidence} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <ExpandableText
                        text={item.status === 'pass' || item.status === 'na' ? '' : item.fix}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleItems.length === 0 && (
              <p className="p-4 text-center text-sm text-ink-muted">沒有符合篩選條件的查核項目。</p>
            )}
          </div>

          {/* 手機版：每個查核項目一張卡 */}
          <div className="space-y-3 md:hidden">
            {visibleItems.map((item) => (
              <div key={item.id} className="card space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium break-words text-ink">
                    <span className="text-ink-muted">{item.id}．</span>
                    {item.title}
                  </span>
                  <StatusBadge status={item.status} className="shrink-0" />
                </div>
                {item.evidence && (
                  <ExpandableText text={item.evidence} label="合約現況：" className="text-sm text-ink-muted" />
                )}
                {item.status !== 'pass' && item.status !== 'na' && item.fix && (
                  <ExpandableText text={item.fix} label="改善方式：" className="text-sm text-warn" />
                )}
              </div>
            ))}
            {visibleItems.length === 0 && (
              <p className="text-center text-sm text-ink-muted">沒有符合篩選條件的查核項目。</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FileSummaryList({ files }: { files: AnalysisFileSummary[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-0.5 pl-5">
      {files.map((file) => (
        <li key={file.id}>
          {file.name}　{formatSize(file.size)}　{EXTRACT_METHOD_LABEL[file.extractMethod]}　共{' '}
          {file.pageCount} 頁
        </li>
      ))}
    </ul>
  );
}
