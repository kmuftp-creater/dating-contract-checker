'use client';

import { Ban, ZoomIn } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Lightbox } from '@/components/lightbox';
import type { ReportCategory, ReportStatus } from '@/lib/types';

import { blockReporterAction, closeReportAction, replyReportAction } from '../actions/reports';

/**
 * 「問題回報」頁的互動主體：回覆、結案、封鎖來源信箱。
 *
 * 這三個伺服器動作都回傳 `void`，做法與 `ips-panel.tsx` 一致：呼叫成功
 * 後用 `router.refresh()` 讓上層伺服器元件重新查詢，不在用戶端維護一份
 * 平行的清單狀態。
 */

export interface ReportReplyView {
  id: string;
  body: string;
  sentEmail: boolean;
  createdAt: string;
}

export interface ReportView {
  id: string;
  clientId: string | null;
  ip: string;
  category: ReportCategory;
  message: string;
  contactEmail: string | null;
  analysisId: string | null;
  status: ReportStatus;
  createdAt: string;
  /** 這筆回報是否附了截圖，附了才顯示縮圖並可點選放大。 */
  hasScreenshot: boolean;
  replies: ReportReplyView[];
}

const CATEGORY_LABEL: Record<ReportCategory, string> = {
  wrong_result: '結果錯誤',
  upload_failed: '上傳失敗',
  regulation_error: '法規內容有誤',
  other: '其他',
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  open: '未處理',
  replied: '已回覆',
  closed: '已結案',
};

const STATUS_COLOR: Record<ReportStatus, string> = {
  open: 'text-danger',
  replied: 'text-info',
  closed: 'text-ink-muted',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function truncateId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

export function ReportsPanel({ reports }: { reports: ReportView[] }) {
  const [openReportId, setOpenReportId] = useState<string | null>(null);

  if (reports.length === 0) {
    return <div className="card p-6 text-sm text-ink-muted">沒有符合篩選條件的問題回報。</div>;
  }

  return (
    <div className="space-y-4">
      {reports.map((report) => (
        <ReportCard key={report.id} report={report} onOpenScreenshot={() => setOpenReportId(report.id)} />
      ))}
      <Lightbox
        src={openReportId ? `/admincenter/api/reports/${openReportId}/screenshot` : null}
        alt="問題回報截圖"
        onClose={() => setOpenReportId(null)}
      />
    </div>
  );
}

function ReportCard({ report, onOpenScreenshot }: { report: ReportView; onOpenScreenshot: () => void }) {
  const router = useRouter();

  const [replyBody, setReplyBody] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [isReplyPending, startReplyTransition] = useTransition();

  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosePending, startCloseTransition] = useTransition();

  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [isBlockPending, startBlockTransition] = useTransition();

  function handleReply(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (replyBody.trim() === '') {
      setReplyError('回覆內容不能是空白。');
      return;
    }
    setReplyError(null);
    startReplyTransition(async () => {
      try {
        const result = await replyReportAction(report.id, replyBody.trim());
        if (!result.ok) {
          setReplyError(result.message);
          return;
        }
        setReplyBody('');
        router.refresh();
      } catch (error) {
        setReplyError(error instanceof Error ? error.message : '回覆失敗。');
      }
    });
  }

  function handleClose(): void {
    setCloseError(null);
    startCloseTransition(async () => {
      try {
        const result = await closeReportAction(report.id);
        if (!result.ok) {
          setCloseError(result.message);
          return;
        }
        router.refresh();
      } catch (error) {
        setCloseError(error instanceof Error ? error.message : '結案失敗。');
      }
    });
  }

  function handleBlock(): void {
    if (!report.contactEmail) return;
    if (
      !window.confirm(
        `確定要封鎖聯絡信箱「${report.contactEmail}」嗎？封鎖後這個信箱將無法再送出問題回報。`,
      )
    ) {
      return;
    }
    setBlockError(null);
    setBlockMessage(null);
    startBlockTransition(async () => {
      try {
        const result = await blockReporterAction(report.contactEmail!);
        if (!result.ok) {
          setBlockError(result.message);
          return;
        }
        setBlockMessage('已封鎖此信箱。');
        router.refresh();
      } catch (error) {
        setBlockError(error instanceof Error ? error.message : '封鎖失敗。');
      }
    });
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 text-sm">
          <p className="text-ink-muted">
            {formatDateTime(report.createdAt)}　{CATEGORY_LABEL[report.category]}
            {report.analysisId && (
              <>

                <Link href={`/admincenter/analyses/${report.analysisId}`} className="text-brand hover:underline">
                  查看關聯分析
                </Link>
              </>
            )}
          </p>
          <p className="text-ink-muted">
            IP：{report.ip}　瀏覽器識別碼：{report.clientId ? truncateId(report.clientId) : '－'}
            {report.contactEmail && `　聯絡信箱：${report.contactEmail}`}
          </p>
        </div>
        <span className={`text-sm font-medium ${STATUS_COLOR[report.status]}`}>{STATUS_LABEL[report.status]}</span>
      </div>

      <p className="rounded-(--radius-control) border border-hairline p-3 text-sm text-ink">{report.message}</p>

      {report.hasScreenshot && (
        <button
          type="button"
          onClick={onOpenScreenshot}
          aria-label="放大檢視回報截圖"
          className="group relative block size-28 overflow-hidden rounded-(--radius-control) border border-hairline"
        >
          <Image
            src={`/admincenter/api/reports/${report.id}/screenshot`}
            alt="回報截圖縮圖"
            fill
            unoptimized
            className="object-cover transition-transform group-hover:scale-105"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
            <ZoomIn className="size-5" aria-hidden />
          </span>
        </button>
      )}

      {report.replies.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-muted">既有回覆</p>
          {report.replies.map((reply) => (
            <div key={reply.id} className="rounded-(--radius-control) bg-canvas p-3 text-sm">
              <p className="text-ink">{reply.body}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {formatDateTime(reply.createdAt)}　{reply.sentEmail ? '已寄出通知信' : '尚未寄出通知信'}
              </p>
            </div>
          ))}
        </div>
      )}

      {report.status !== 'closed' && (
        <form onSubmit={handleReply} className="space-y-2">
          <label htmlFor={`reply-${report.id}`} className="block text-xs text-ink-muted">
            回覆內容
          </label>
          <textarea
            id={`reply-${report.id}`}
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            rows={3}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas p-2 text-sm text-ink"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isReplyPending}
              className="rounded-(--radius-control) bg-brand px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isReplyPending ? '送出中…' : '回覆'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isClosePending}
              className="rounded-(--radius-control) border border-hairline px-3 py-1.5 text-sm text-ink transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isClosePending ? '結案中…' : '結案'}
            </button>
            {report.contactEmail && (
              <button
                type="button"
                onClick={handleBlock}
                disabled={isBlockPending}
                className="ml-auto inline-flex items-center gap-1.5 rounded-(--radius-control) border border-danger/50 px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Ban className="size-3.5" aria-hidden />
                {isBlockPending ? '封鎖中…' : '封鎖此信箱'}
              </button>
            )}
          </div>
          {replyError && <p className="text-sm text-danger">{replyError}</p>}
          {closeError && <p className="text-sm text-danger">{closeError}</p>}
          {blockError && <p className="text-sm text-danger">{blockError}</p>}
          {blockMessage && <p className="text-sm text-ok">{blockMessage}</p>}
        </form>
      )}

      {report.status === 'closed' && report.contactEmail && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBlock}
            disabled={isBlockPending}
            className="inline-flex items-center gap-1.5 rounded-(--radius-control) border border-danger/50 px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Ban className="size-3.5" aria-hidden />
            {isBlockPending ? '封鎖中…' : '封鎖此信箱'}
          </button>
          {blockError && <p className="text-sm text-danger">{blockError}</p>}
          {blockMessage && <p className="text-sm text-ok">{blockMessage}</p>}
        </div>
      )}
    </div>
  );
}
