/**
 * 提示詞組裝。
 *
 * 產出 OpenAI 相容的 messages 陣列。法規內容（查核表、公告全文）放在最
 * 前面，合約內容放後面，讓 Gemini 的前綴快取折扣能吃到每次分析都相同的
 * 法規段落（見設計文件第四章第 2、3 節）。
 */

import type { ExtractedImage } from '@/lib/types';

/** 訊息文字內容的單一片段。 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** OpenAI 相容的單則訊息。 */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: ChatContentPart[] };

export interface BuildMessagesInput {
  /** 查核表（後台生效版本）的 markdown 全文。 */
  checklistMarkdown: string;
  /** 應記載及不得記載事項公告全文的 markdown 全文。 */
  regulationMarkdown: string;
  /** 合約抽出的純文字，無文字內容時為空字串。 */
  contractText: string;
  /** 合約的圖片頁面，走影像辨識路徑時使用。 */
  contractImages: ExtractedImage[];
}

const SYSTEM_PROMPT = `你是「交友媒合服務定型化契約查核員」。你的任務是依照使用者提供的查核表，逐項判定使用者上傳的合約內容是否符合規定。

規則：
1. 只依附上的查核表逐項判定，不自行新增查核表以外的項目。
2. 查核表「壹」與「貳」的每一個項目都必須出現在 items 陣列中，一項都不能省略，順序與查核表一致，id 直接沿用查核表的序號欄（例如 1、2-1、4-3、B-1）。即使該項判定為 pass，也要列出來。
3. 每一個查核項目的 status 只能是以下四種之一：pass（符合）、fail（不符合）、fix（建議修正，形式上有寫但寫法不足）、na（不適用，合約未涉及該服務）。
4. status 為 fail 或 fix 時，fix 欄位要給改善方式，限兩句以內，並引用查核表項次與公告點次；status 為 pass 或 na 時，fix 欄位一律留空字串。
5. evidence 要盡量引用合約的原文片段，而不是你自己的轉述，方便使用者回頭核對。
6. 合約完全未涉及的服務項目，判為 na，不要用 fail。
7. 合約中找不到對應內容時，判為 fail，不要用假設或猜測的內容補上 evidence。
8. 只輸出一個 JSON 物件，不要輸出 JSON 以外的任何文字或說明。

輸出的 JSON 結構固定如下：
{
  "items": [
    { "id": "查核表項次", "title": "查核項目名稱", "status": "pass | fail | fix | na", "evidence": "合約中對應內容的摘要或原文片段，找不到時為空字串", "fix": "改善方式，只有 fail 與 fix 時有值" }
  ],
  "summary": { "pass": 0, "fail": 0, "fix": 0, "na": 0 },
  "notes": "無法判定的部分，例如影像模糊，沒有則為空字串"
}`;

/** 把圖片轉成 OpenAI 相容的 data URL 圖片片段。 */
function toImagePart(image: ExtractedImage): ChatContentPart[] {
  const dataUrl = `data:${image.mime};base64,${image.data.toString('base64')}`;
  return [
    { type: 'text', text: `［圖片：${image.label}］` },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];
}

/** 組裝要送給閘道的 messages 陣列。 */
export function buildMessages(input: BuildMessagesInput): ChatMessage[] {
  const regulationPart: ChatContentPart = {
    type: 'text',
    text: `【查核表】\n${input.checklistMarkdown}\n\n【應記載及不得記載事項公告全文】\n${input.regulationMarkdown}`,
  };

  const contractParts: ChatContentPart[] = [];
  if (input.contractText.trim().length > 0) {
    contractParts.push({
      type: 'text',
      text: `【合約內容（文字抽取）】\n${input.contractText}`,
    });
  }
  if (input.contractImages.length > 0) {
    contractParts.push({ type: 'text', text: '【合約內容（影像頁面）】' });
    for (const image of input.contractImages) {
      contractParts.push(...toImagePart(image));
    }
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: [regulationPart, ...contractParts] },
  ];
}

/**
 * 粗估文字的 token 數。
 *
 * 中文字（含全形符號）約 1 字 1 token，其餘（英文、數字、半形符號）約
 * 4 字元 1 token，只作為送出前的門檻判斷用，非精確計算。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  let otherCount = 0;
  for (const ch of text) {
    if (isCjkChar(ch)) {
      cjkCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return cjkCount + Math.ceil(otherCount / 4);
}

function isCjkChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 統一表意文字
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 擴充 A
    (code >= 0xf900 && code <= 0xfaff) || // CJK 相容表意文字
    (code >= 0xff00 && code <= 0xffef) // 全形字元與符號
  );
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

/**
 * 合約文字超過 token 上限時從中間截斷，保留頭尾，中間插入省略標記。
 *
 * 頭尾各分配一半預算，逐字元累加粗估 token 數直到用完預算為止，屬於估算，
 * 不保證截斷後精確等於 maxTokens。
 */
export function truncateContract(text: string, maxTokens: number): TruncateResult {
  if (estimateTokens(text) <= maxTokens) {
    return { text, truncated: false };
  }

  const marker = '\n\n（中間內容已省略）\n\n';
  const markerTokens = estimateTokens(marker);
  const budget = Math.max(maxTokens - markerTokens, 0);
  const headBudget = Math.floor(budget / 2);
  const tailBudget = budget - headBudget;

  const head = takeByTokenBudget(text, headBudget, 'head');
  const tail = takeByTokenBudget(text, tailBudget, 'tail');

  return { text: `${head}${marker}${tail}`, truncated: true };
}

/** 依 token 預算，從文字頭或尾取出盡量多的字元。 */
function takeByTokenBudget(text: string, budget: number, direction: 'head' | 'tail'): string {
  if (budget <= 0) return '';
  const chars = Array.from(text);
  let acc = 0;

  if (direction === 'head') {
    let result = '';
    for (const ch of chars) {
      const t = estimateTokens(ch);
      if (acc + t > budget) break;
      acc += t;
      result += ch;
    }
    return result;
  }

  let result = '';
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const ch = chars[i];
    const t = estimateTokens(ch);
    if (acc + t > budget) break;
    acc += t;
    result = ch + result;
  }
  return result;
}
