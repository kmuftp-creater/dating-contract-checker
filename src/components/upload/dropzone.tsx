'use client';

import { UploadCloud } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

/**
 * 拖曳或點選上傳區。
 *
 * 只負責把使用者選取的檔案交給 `onFiles`，不負責上傳或驗證——那些
 * 邏輯留給呼叫端（`src/app/page.tsx`），因為驗證需要知道目前已選檔案數
 * 與 `GET /api/quota` 回傳的上限，這個元件不需要知道那些狀態。
 */

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** 單批最多可上傳幾個檔案，來自 `GET /api/quota`；未載入時顯示「載入中」。 */
  maxFilesPerBatch: number | null;
  /** 圖片與其他檔案的單檔大小上限（位元組），來自 `GET /api/quota`。 */
  maxImageBytes: number | null;
  maxDocumentBytes: number | null;
}

export function Dropzone({
  onFiles,
  disabled,
  maxFilesPerBatch,
  maxImageBytes,
  maxDocumentBytes,
}: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) {
        onFiles(files);
      }
    },
    [disabled, onFiles],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) {
        onFiles(files);
      }
      // 清空 value，允許使用者重新選取同一個檔案。
      event.target.value = '';
    },
    [onFiles],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-(--radius-control) border-2 border-dashed px-4 py-10 text-center transition-colors ${
          disabled
            ? 'cursor-not-allowed border-hairline opacity-60'
            : dragging
              ? 'border-brand bg-brand/5'
              : 'border-hairline hover:border-brand'
        }`}
      >
        <UploadCloud className="size-8 text-ink-muted" aria-hidden />
        <p className="text-sm text-ink">
          拖曳檔案到這裡，或<span className="text-brand">點選選擇檔案</span>
        </p>
        <p className="text-xs text-ink-muted">
          支援格式：圖片（JPG、PNG、BMP、HEIC、HEIF）、PDF、TXT、Word（DOCX）、Excel（XLSX、XLS）。
          單批最多 {maxFilesPerBatch ?? '－'} 個檔案；圖片單檔上限
          {' '}
          {maxImageBytes !== null ? formatMb(maxImageBytes) : '－'}，其他檔案單檔上限
          {' '}
          {maxDocumentBytes !== null ? formatMb(maxDocumentBytes) : '－'}。
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={disabled}
        onChange={handleInputChange}
        className="hidden"
        accept=".jpg,.jpeg,.png,.bmp,.heic,.heif,.pdf,.txt,.docx,.xlsx,.xls"
      />
    </div>
  );
}
