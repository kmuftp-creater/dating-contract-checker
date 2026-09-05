/**
 * AI 回傳 JSON 的 zod 結構與解析。
 *
 * 模型的輸出無法完全信任，這個檔案負責把「AI 說它回了什麼」轉成程式可以
 * 安全使用的 `AnalysisResult`。解析時要能處理常見的髒輸出：外層包
 * ```json 圍籬、前後有說明文字、結尾多逗號；解析成功後一律重算
 * summary，不採信模型自己數的數字。
 */

import { z } from 'zod';

import type { AnalysisResult, CheckItem, CheckStatus } from '@/lib/types';

/** 查核狀態的四種值。 */
const CheckStatusSchema = z.enum(['pass', 'fail', 'fix', 'na']);

/** 單一查核項目的寬鬆結構：欄位型別錯誤或缺漏時，用空字串頂替，不整包失敗。 */
const RawCheckItemSchema = z.object({
  id: z.coerce.string(),
  title: z.string().catch(''),
  status: CheckStatusSchema,
  evidence: z.string().catch(''),
  fix: z.string().catch(''),
});

/**
 * 模型回傳 JSON 的整體結構。
 *
 * `summary` 刻意不做欄位驗證（收下即可，不使用），因為程式會重算，不信任
 * 模型自己數的數字；`items` 則保持嚴格，缺漏或型別錯誤時要讓整體解析失敗，
 * 交由上層（`analyze.ts`）決定要不要重試。
 */
const RawAnalysisResultSchema = z.object({
  items: z.array(RawCheckItemSchema),
  summary: z.unknown().optional(),
  notes: z.string().catch(''),
});

/**
 * 從模型原始輸出中取出可能的 JSON 文字。
 *
 * 依序嘗試：去除頭尾空白 → 抓出 ```json 圍籬內的內容（若有）→ 截取第一個
 * `{` 到最後一個 `}` 之間的內容（去掉圍籬外的說明文字）→ 移除 `}`、`]`
 * 前多餘的逗號。每一步都是儘量修正，不保證一定能解析成功。
 */
function extractJsonText(raw: string): string {
  const trimmed = raw.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  }

  // 移除物件與陣列結尾多餘的逗號，例如 { "a": 1, } 或 [1, 2, ]。
  candidate = candidate.replace(/,(\s*[}\]])/g, '$1');

  return candidate;
}

/** 依實際 items 重新計算的統計數字，不採信模型回傳的 summary。 */
function recomputeSummary(items: CheckItem[]): AnalysisResult['summary'] {
  const summary: AnalysisResult['summary'] = { pass: 0, fail: 0, fix: 0, na: 0 };
  for (const item of items) {
    summary[item.status] += 1;
  }
  return summary;
}

/** pass 與 na 不給建議，強制清空 fix。 */
function clearFixIfNotApplicable(status: CheckStatus, fix: string): string {
  return status === 'pass' || status === 'na' ? '' : fix;
}

/**
 * 解析模型回傳的原始文字為 `AnalysisResult`。
 *
 * 解析失敗（JSON 語法錯誤、結構不符）一律拋出中文錯誤，訊息含實際收到內容
 * 的前 200 字，方便除錯與記錄。
 */
export function parseAnalysisResult(raw: string): AnalysisResult {
  const preview = raw.slice(0, 200);
  const jsonText = extractJsonText(raw);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `AI 回傳內容無法解析為 JSON（${detail}）。實際收到的前 200 字：${preview}`,
    );
  }

  const validated = RawAnalysisResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((issue) => `${issue.path.join('.') || '(根)'}：${issue.message}`)
      .join('；');
    throw new Error(
      `AI 回傳的 JSON 結構不符合預期（${issues}）。實際收到的前 200 字：${preview}`,
    );
  }

  const items: CheckItem[] = validated.data.items.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    evidence: item.evidence,
    fix: clearFixIfNotApplicable(item.status, item.fix),
  }));

  return {
    items,
    summary: recomputeSummary(items),
    notes: validated.data.notes,
  };
}
