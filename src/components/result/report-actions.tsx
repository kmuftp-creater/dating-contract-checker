'use client';

import { Check, Copy, Download, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { buildReportFilename, buildReportText, type ReportTextInput } from '@/lib/report-text';

/**
 * 「複製結果」「下載 TXT」「下載 PDF」三顆動作按鈕。
 *
 * 複製與下載 TXT 共用 `buildReportText` 產生的同一份純文字。下載 PDF
 * 刻意不用任何 PDF 產生套件，改用瀏覽器原生的 `window.print()`：中文
 * PDF 若要自己產生就得內嵌中文字型，部署包會多出十幾 MB，而瀏覽器列印
 * 輸出的文字仍可選取、品質也更好，`globals.css` 的 `@media print`
 * 規則負責把頁面收整成適合列印的樣子。
 */

type CopyState = 'idle' | 'copied' | 'failed';

const COPY_RESET_MS = 2000;

export function ReportActions({ analysisId, input }: { analysisId: string; input: ReportTextInput }) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  const reportText = buildReportText(input);
  const filename = buildReportFilename(new Date(input.createdAt), analysisId);

  // 複製失敗時改顯示備援文字框；掛載後把焦點移過去並選取全文，
  // 讓使用者可以直接按 Ctrl+C 自行複製，而不是把游標移動邏輯塞進
  // click handler 裡跟還沒掛載的節點賽跑。
  useEffect(() => {
    if (copyState === 'failed') {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [copyState]);

  async function copyToClipboard() {
    try {
      if (!navigator.clipboard) {
        throw new Error('瀏覽器不支援剪貼簿 API');
      }
      await navigator.clipboard.writeText(reportText);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), COPY_RESET_MS);
    } catch {
      // 不安全來源（非 https）或使用者拒絕權限時會擲錯：改為選取文字讓
      // 使用者自行複製，不能靜默失敗。
      setCopyState('failed');
    }
  }

  function handleCopyClick() {
    void copyToClipboard();
  }

  function handleDownloadTxt() {
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="print-hide flex flex-wrap items-start gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={handleCopyClick} className="btn-secondary text-sm">
          {copyState === 'copied' ? (
            <>
              <Check className="size-4" aria-hidden />
              已複製
            </>
          ) : (
            <>
              <Copy className="size-4" aria-hidden />
              複製結果
            </>
          )}
        </button>

        <button type="button" onClick={handleDownloadTxt} className="btn-secondary text-sm">
          <Download className="size-4" aria-hidden />
          下載 TXT
        </button>

        <div className="flex flex-col gap-1">
          <button type="button" onClick={handlePrint} className="btn-secondary text-sm">
            <Printer className="size-4" aria-hidden />
            下載 PDF
          </button>
          <span className="text-xs text-ink-muted">會開啟瀏覽器的列印視窗，選擇「另存為 PDF」</span>
        </div>
      </div>

      {copyState === 'failed' && (
        <div className="w-full space-y-1">
          <p className="text-sm text-danger">自動複製失敗，請在下方文字框內按 Ctrl+C（或 Cmd+C）自行複製。</p>
          <textarea
            ref={fallbackRef}
            readOnly
            value={reportText}
            className="h-40 w-full rounded-(--radius-control) border border-hairline bg-surface p-2 font-mono text-xs text-ink"
            aria-label="分析結果純文字，複製失敗時可自行選取複製"
          />
        </div>
      )}
    </div>
  );
}
