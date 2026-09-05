import 'server-only';

import type { AnalysisMode, ReportCategory } from '@/lib/types';

/**
 * 信件內容組裝。
 *
 * 兩個原則：
 * 1. 內容一律繁體中文。
 * 2. 不夾帶完整的合約內文，只放摘要數字與檔案清單──合約現況、原文片段
 *    這些欄位在 `AnalysisResult.items` 裡，這裡刻意不讀取那個欄位。
 */

/**
 * 信件內容的組裝。
 *
 * 這個檔案只放**共用的小工具**與問題回報回覆通知的範本。由擴充點
 * （`./hooks.ts`）掛上來的信件，範本放在各自的模組裡，這樣沒有掛那個擴充
 * 的部署就連它的文案都不會有，不會留下沒有人用的殘骸。
 */

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

export const MODE_LABELS: Record<AnalysisMode, string> = {
  merged: '合併為一份合約',
  separate: '各檔獨立分析',
};

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  wrong_result: '分析結果有誤',
  upload_failed: '上傳失敗',
  regulation_error: '法規內容錯誤',
  other: '其他',
};

export function formatTaipei(date: Date): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function htmlParagraphs(lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n');
}

// ---------------------------------------------------------------------------
// 問題回報回覆通知
// ---------------------------------------------------------------------------

export interface ReplyEmailParams {
  reportId: string;
  category: ReportCategory;
  message: string;
  replyBody: string;
  createdAt: Date;
}

export function buildReplyEmail(params: ReplyEmailParams): BuiltEmail {
  const dateLabel = formatTaipei(params.createdAt);
  const shortId = params.reportId.slice(0, 8);
  const subject = `【交友合約健檢】您的問題回報（${shortId}）已有回覆`;

  const textLines = [
    '您先前送出的問題回報已由管理員回覆，內容如下：',
    '',
    `回報類型：${CATEGORY_LABELS[params.category]}`,
    `您的原始描述：${params.message}`,
    '',
    '管理員回覆：',
    params.replyBody,
    '',
    `回覆時間：${dateLabel}`,
  ];

  const html = [
    '<p>您先前送出的問題回報已由管理員回覆，內容如下：</p>',
    htmlParagraphs([
      `回報類型：${CATEGORY_LABELS[params.category]}`,
      `您的原始描述：${params.message}`,
    ]),
    '<p>管理員回覆：</p>',
    `<blockquote>${escapeHtml(params.replyBody).replace(/\n/g, '<br />')}</blockquote>`,
    `<p>回覆時間：${escapeHtml(dateLabel)}</p>`,
  ].join('\n');

  return { subject, text: textLines.join('\n'), html };
}
