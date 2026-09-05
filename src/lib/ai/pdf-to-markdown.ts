/**
 * PDF 轉 markdown 草稿：後台「上傳 PDF 產生草稿」功能的核心邏輯。
 *
 * 背景（見設計文件第三章第 9-1 節）：內政部只發 PDF，但系統儲存格式必須是
 * markdown，因為查核表表格第一欄的項次編號是漏判偵測（見 `./checklist.ts`）
 * 的依據，PDF 直接抽出來會變成連續文字、表格結構消失。這裡做成輔助流程：
 * 抽出 PDF 文字後，請 AI 照現行生效版本的表格格式重排成 markdown，
 * 產出草稿讓管理員檢查修正後再發布，草稿本身不會自動儲存或發布。
 *
 * `callGateway`（見 `./gateway.ts`）固定要求模型以 `response_format:
 * json_object` 回覆，因此提示詞要求模型輸出 `{"markdown": "..."}` 這個
 * JSON 物件，而不是直接輸出裸 markdown。即使如此，模型仍有機會在
 * `markdown` 欄位的字串值裡，把內容包一層 ```markdown 圍籬或加上前後
 * 廢話，`stripMarkdownFences` 負責把這些雜訊剝掉。
 */

import { extractChecklistIds } from './checklist';
import { callGateway } from './gateway';
import type { ChatMessage } from './prompt';

export interface BuildPdfToMarkdownMessagesInput {
  /** 現行生效版本的 markdown 全文，當作格式範本；尚無生效版本時為空字串。 */
  currentMarkdown: string;
  /** PDF 抽出的純文字。 */
  pdfText: string;
}

const SYSTEM_PROMPT = `你是文件格式轉換助手。你的任務是把使用者提供的 PDF 抽出文字，依照「現行生效版本」的 markdown 表格格式重新排版成 markdown。

規則：
1. 保留原本的表格結構，欄位順序與現行版本一致。
2. 表格第一欄是查核項次編號（例如 1、2-1、10-4、B-3），這是系統用來比對漏判的依據，務必逐項保留、不可省略或合併，也不可自行新增現行版本沒有的欄位。
3. 只重新排版格式，不改寫、不新增、不省略 PDF 文字裡的實質內容。
4. 只能輸出一個 JSON 物件，格式固定為 {"markdown": "轉換後的 markdown 全文"}，不要輸出 JSON 以外的任何文字或說明。
5. markdown 欄位的值必須是純 markdown 內容本身，不要再用 \`\`\` 圍籬包住，也不要加「以下是轉換結果」之類的前言或結語。`;

/** 組裝要送給閘道的 messages 陣列。 */
export function buildPdfToMarkdownMessages(
  input: BuildPdfToMarkdownMessagesInput,
): ChatMessage[] {
  const templateText =
    input.currentMarkdown.trim() === ''
      ? '（目前尚無生效版本可當範本，請依查核表慣例排版：表格第一欄為項次編號，例如 1、2-1、B-3。）'
      : input.currentMarkdown;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `【現行生效版本的 markdown（格式範本）】\n${templateText}\n\n【PDF 抽出的文字（待轉換內容）】\n${input.pdfText}`,
        },
      ],
    },
  ];
}

/**
 * 剝掉模型回覆裡的圍籬與前後廢話，取出純 markdown。
 *
 * 依序嘗試：
 * 1. 找出第一個 \`\`\`（可能標了 markdown 語言）與對應的最後一個 \`\`\`，
 *    取中間內容。
 * 2. 找不到成對圍籬時，原樣回傳（trim 過）。
 */
export function stripMarkdownFences(raw: string): string {
  const text = raw.trim();

  const fenceStart = text.match(/```[a-zA-Z]*\r?\n/);
  if (fenceStart && fenceStart.index !== undefined) {
    const contentStart = fenceStart.index + fenceStart[0].length;
    const fenceEnd = text.lastIndexOf('```');
    if (fenceEnd > contentStart) {
      return text.slice(contentStart, fenceEnd).trim();
    }
  }

  return text;
}

/**
 * 從閘道回應的原始內容中取出 markdown 草稿。
 *
 * `callGateway` 固定要求 JSON 物件回應，正常情況下 `content` 會是
 * `{"markdown": "..."}` 這個形狀；為求穩健，JSON 解析失敗或沒有
 * `markdown` 欄位時退回直接對整段內容剝殼，避免模型偶爾沒有完全照
 * 格式要求回覆時整條流程直接失敗。
 */
export function extractMarkdownFromResponse(content: string): string {
  const trimmed = content.trim();

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'markdown' in parsed &&
      typeof (parsed as { markdown: unknown }).markdown === 'string'
    ) {
      return stripMarkdownFences((parsed as { markdown: string }).markdown);
    }
  } catch {
    // 不是合法 JSON，退回直接剝殼。
  }

  return stripMarkdownFences(trimmed);
}

export interface ConvertPdfToMarkdownOptions {
  currentMarkdown: string;
  pdfText: string;
  gateway: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  clientId: string;
}

export interface ConvertPdfToMarkdownResult {
  /** 轉換後的 markdown 草稿，尚未儲存也尚未發布。 */
  markdown: string;
  /** 這份草稿可解析出幾個查核項次，讓管理員立刻看得出格式有沒有跑掉。 */
  checklistIdCount: number;
  /** 實際使用的模型別名。 */
  model: string;
}

/** 呼叫 AI 閘道，把 PDF 抽出的文字轉成 markdown 草稿。 */
export async function convertPdfToMarkdownDraft(
  options: ConvertPdfToMarkdownOptions,
): Promise<ConvertPdfToMarkdownResult> {
  const messages = buildPdfToMarkdownMessages({
    currentMarkdown: options.currentMarkdown,
    pdfText: options.pdfText,
  });

  const result = await callGateway({
    baseUrl: options.gateway.baseUrl,
    apiKey: options.gateway.apiKey,
    model: options.gateway.model,
    messages,
    clientId: options.clientId,
    feature: 'pdf_to_markdown_draft',
  });

  const markdown = extractMarkdownFromResponse(result.content);
  const checklistIdCount = extractChecklistIds(markdown).length;

  return { markdown, checklistIdCount, model: result.model };
}
