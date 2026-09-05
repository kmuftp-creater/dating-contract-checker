'use client';

import clsx from 'clsx';
import { useState } from 'react';

/**
 * 可展開／收合的長文字，用在結果表格的「合約現況」「改善方式」欄。
 *
 * AI 回傳的內容常常整段引用合約原文，長度差異很大；直接塞進儲存格會把
 * 單一列撐得很高，拖累整份報告的可讀性。這裡預設只顯示前三行，超過門檻
 * 才出現「展開」。
 *
 * 展開狀態只影響螢幕上的呈現：`result-clamp` 這個 class 是刻意留給
 * `globals.css` 的 `@media print` 規則掛勾用的，讓列印（下載 PDF）時
 * 一律強制完整展開，不受這裡的 React state 影響。
 */

const LENGTH_THRESHOLD = 60;

export function ExpandableText({
  text,
  label,
  className,
}: {
  text: string;
  /** 選填的欄位標籤，會以粗體印在內容前面，卡片版用得到。 */
  label?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!text) {
    return (
      <p className={clsx('text-ink-muted', className)}>
        {label && <span className="font-medium text-ink">{label}</span>}－
      </p>
    );
  }

  const isLong = text.length > LENGTH_THRESHOLD;

  return (
    <div className={className}>
      <p
        className={clsx(
          'result-clamp whitespace-pre-wrap break-words',
          isLong && !expanded && 'line-clamp-3',
        )}
      >
        {label && <span className="font-medium text-ink">{label}</span>}
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 text-xs font-medium text-brand hover:underline"
        >
          {expanded ? '收合' : '展開'}
        </button>
      )}
    </div>
  );
}
