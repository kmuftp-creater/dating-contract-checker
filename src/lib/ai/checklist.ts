/**
 * 查核表項次的解析與覆蓋率檢查。
 *
 * 為什麼需要這個：模型有機會「只回報有問題的項目」而略過判定為符合的項目。
 * 那樣使用者會看到一份少了十幾列的報告，卻以為其餘都沒問題。這裡從查核表
 * 本身解析出應有的項次，事後比對模型實際回了哪些，缺漏就明白寫進 notes。
 *
 * 查核表是後台可編輯的內容，所以項次一律動態解析，不寫死在程式碼裡。
 */

import type { AnalysisResult, CheckItem } from '@/lib/types';

/**
 * 合法的項次格式：
 * - 應記載事項用數字，可帶子項，例如 `1`、`2-1`、`10-4`
 * - 不得記載事項用 B 開頭，例如 `B-1`、`B-13`
 */
const ID_PATTERN = /^(?:\d{1,3}(?:-\d{1,3})?|B-\d{1,3})$/i;

/**
 * 從查核表的 markdown 表格中抽出所有項次。
 *
 * 只認「表格第一欄」的內容，且必須符合項次格式，
 * 因此表頭列、分隔列、說明文字都會被自動略過。
 */
export function extractChecklistIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;

    // 去掉頭尾的分隔線後取第一欄。
    const firstCell = trimmed.slice(1).split('|')[0]?.trim() ?? '';
    if (!ID_PATTERN.test(firstCell)) continue;

    const id = firstCell.toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export interface CoverageReport {
  /** 查核表列出、但模型沒有回報的項次。 */
  missing: string[];
  /** 模型回報了、但查核表沒有的項次。 */
  unexpected: string[];
}

/** 比對模型的回覆是否涵蓋查核表的每一項。 */
export function checkCoverage(
  expectedIds: string[],
  items: CheckItem[],
): CoverageReport {
  const returned = new Set(items.map((item) => item.id.trim().toUpperCase()));
  const expected = new Set(expectedIds);

  return {
    missing: expectedIds.filter((id) => !returned.has(id)),
    unexpected: [...returned].filter((id) => !expected.has(id)),
  };
}

/**
 * 把覆蓋率問題寫進結果的 notes。
 *
 * 只補說明，不自行捏造缺漏項目的判定：使用者需要知道的是「這幾項沒被檢查」，
 * 而不是拿到一個看起來完整、實際上是程式編出來的判定。
 */
export function annotateCoverage(
  result: AnalysisResult,
  coverage: CoverageReport,
): AnalysisResult {
  const notes: string[] = [];

  if (coverage.missing.length > 0) {
    notes.push(
      `以下查核項目未被判定，請自行核對或重新分析：${coverage.missing.join('、')}。`,
    );
  }
  if (coverage.unexpected.length > 0) {
    notes.push(
      `以下項次不在查核表內，已一併列出供參考：${coverage.unexpected.join('、')}。`,
    );
  }

  if (notes.length === 0) {
    return result;
  }

  const combined = result.notes ? `${notes.join(' ')} ${result.notes}` : notes.join(' ');
  return { ...result, notes: combined };
}
