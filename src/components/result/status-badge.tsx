import clsx from 'clsx';
import { CheckCircle2, Circle, Minus, XCircle, type LucideIcon } from 'lucide-react';

import type { CheckStatus } from '@/lib/types';

/**
 * 查核判定的圖示與顏色，對應設計文件與參考截圖的四種判定：
 * 符合（綠勾）、不符合（紅叉）、建議修正（黃點）、不適用（灰線）。
 */

interface StatusConfig {
  label: string;
  colorClassName: string;
  Icon: LucideIcon;
  fill: boolean;
}

const STATUS_CONFIG: Record<CheckStatus, StatusConfig> = {
  pass: { label: '符合', colorClassName: 'text-ok', Icon: CheckCircle2, fill: false },
  fail: { label: '不符合', colorClassName: 'text-danger', Icon: XCircle, fill: false },
  fix: { label: '建議修正', colorClassName: 'text-warn', Icon: Circle, fill: true },
  na: { label: '不適用', colorClassName: 'text-ink-muted', Icon: Minus, fill: false },
};

export function StatusBadge({ status, className }: { status: CheckStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.Icon;
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 text-sm font-medium', config.colorClassName, className)}
    >
      <Icon className={clsx('size-4', config.fill && 'fill-current')} aria-hidden />
      {config.label}
    </span>
  );
}
