'use client';

import { CheckCircle2, Loader2, Trash2, XCircle } from 'lucide-react';

import type { UploadFileResponse } from '@/lib/api-contract';
import type { ExtractMethod } from '@/lib/types';

/**
 * 上傳中的單一檔案狀態，由 `src/app/page.tsx` 維護、傳入這裡純顯示。
 */
export interface UploadItem {
  /** 前端本地產生的識別碼，與後端的 `fileId` 無關，純粹給 React key 與移除操作用。 */
  localId: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  /** 上傳進度百分比，0 到 100。 */
  progress: number;
  result?: UploadFileResponse;
  error?: string;
}

const EXTRACT_METHOD_LABEL: Record<ExtractMethod, string> = {
  text: '文字抽取',
  ocr: '影像辨識',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FileListProps {
  items: UploadItem[];
  onRemove: (localId: string) => void;
}

export function FileList({ items, onRemove }: FileListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className="mt-4 space-y-2">
      {items.map((item) => (
        <li
          key={item.localId}
          className="flex flex-col gap-2 rounded-(--radius-control) border border-hairline p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {item.status === 'uploading' && (
                <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" aria-hidden />
              )}
              {item.status === 'done' && (
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
              )}
              {item.status === 'error' && (
                <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
              )}
              <span className="truncate text-sm font-medium text-ink" title={item.file.name}>
                {item.file.name}
              </span>
              <span className="shrink-0 text-xs text-ink-muted">{formatSize(item.file.size)}</span>
            </div>

            {item.status === 'uploading' && (
              <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-brand transition-[width]"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            )}

            {item.status === 'done' && item.result && (
              <p className="mt-1 text-xs text-ink-muted">
                {EXTRACT_METHOD_LABEL[item.result.extractMethod]}　共 {item.result.pageCount} 頁
                {item.result.notes.length > 0 && (
                  <span className="ml-1 text-warn">｜{item.result.notes.join('；')}</span>
                )}
              </p>
            )}

            {item.status === 'error' && item.error && (
              <p className="mt-1 text-xs text-danger">{item.error}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onRemove(item.localId)}
            className="flex shrink-0 items-center gap-1 self-start rounded-(--radius-control) border border-hairline px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-danger hover:text-danger sm:self-auto"
          >
            <Trash2 className="size-3.5" aria-hidden />
            移除
          </button>
        </li>
      ))}
    </ul>
  );
}
