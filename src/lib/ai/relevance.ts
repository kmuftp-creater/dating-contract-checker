/**
 * 「這份文件是不是交友媒合服務契約」的低成本分類。
 *
 * 對應 2026-09-05 需求：偵測到上傳的不是交友媒合服務契約時要警告使用者，
 * 惡意或誤操作重複上傳時走階梯式處置（見 `src/lib/guard/off-topic.ts`）。
 *
 * ---------------------------------------------------------------------------
 * 最重要的設計前提：誤判會把真正要用的人擋在門外，因此判斷必須保守。
 * ---------------------------------------------------------------------------
 * 1. 只送一小段內容分類（純文字約 2,000 字元、有圖片時只送第一張），
 *    不是為了省字數而犧牲判斷品質，而是分類本身不需要看全文——
 *    這份文件「像不像」交友媒合契約，開頭與中段的用詞就足夠判斷。
 * 2. 呼叫端（`src/app/api/analyses/route.ts`）只有在
 *    `isTargetContract === false` 且 `confidence === 'high'` 時才視為
 *    非目標文件；其餘一律放行，不擋。
 * 3. 這裡呼叫 AI 失敗（逾時、連線失敗、HTTP 錯誤、回應不是合法 JSON、
 *    缺必要欄位）一律回傳「視為目標契約、confidence 為 low」，也就是
 *    放行——偵測機制本身壞掉，不該連帶讓使用者的正常上傳也被擋下。
 *
 * 呼叫方式沿用 `gateway.ts` 既有的 `callGateway`（與後台「測試連線」按鈕
 * 相同的呼叫方式），不另外接一條 AI 呼叫路徑，也不用完整的備援鏈
 * （`chain.ts`）——分類失敗直接放行即可，不需要換一個上游再試。
 */

import type { ExtractedImage } from '@/lib/types';

import { callGateway } from './gateway';
import type { ChatContentPart, ChatMessage } from './prompt';

export interface RelevanceGatewayConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 成本歸戶：metadata.client_id。 */
  clientId: string;
  /** 成本歸戶：metadata.feature，固定使用 `relevance_check`，與正式分析的 `analyze` 區分開。 */
  feature: string;
}

export interface CheckRelevanceInput {
  /** 合約抽出的純文字，無文字內容時為空字串。 */
  contractText: string;
  /** 合約的圖片頁面；純文字合約為空陣列。 */
  contractImages: ExtractedImage[];
  gateway: RelevanceGatewayConfig;
}

export interface RelevanceCheckResult {
  /** 是否判定為交友媒合服務契約。 */
  isTargetContract: boolean;
  /**
   * 這次上傳的內容裡是否包含**契約正本**。
   *
   * 為什麼要跟 `isTargetContract` 分開：交友契約常常拆成好幾份文件，
   * 例如「服務合約書」加上「消費借貸告知確認書」。單獨上傳附件時，
   * 它確實與交友媒合有關（`isTargetContract` 為 true），但查核表的
   * 應記載事項幾乎都寫在正本裡，只拿附件去比對會得到一整排假的「不符合」——
   * 那份報告比不給報告更糟，因為它看起來像結論。
   */
  hasMainContract: boolean;
  /** 判斷的把握程度；判斷不出來一律為 low。 */
  confidence: 'high' | 'low';
  /** 系統看起來收到的是什麼文件，供錯誤訊息顯示，判斷不出來可為空字串。 */
  documentType: string;
  /** 一句話的判斷理由。 */
  reason: string;
}

/** 呼叫失敗或判斷不出來時的保守結果：一律視為目標契約（放行），confidence 為 low。 */
function fallbackAllowResult(reason: string): RelevanceCheckResult {
  return { isTargetContract: true, hasMainContract: true, confidence: 'low', documentType: '', reason };
}

const HEAD_CHARS = 1200;
const MID_CHARS = 800;

/** 只取開頭與中段，合計約 2,000 字元，不送整份文件（見檔頭「重要的設計前提」）。 */
function sampleContractText(text: string): string {
  if (text.length <= HEAD_CHARS + MID_CHARS) {
    return text;
  }
  const head = text.slice(0, HEAD_CHARS);
  const midStart = Math.max(Math.floor(text.length / 2) - Math.floor(MID_CHARS / 2), HEAD_CHARS);
  const mid = text.slice(midStart, midStart + MID_CHARS);
  return `${head}\n…（中略）…\n${mid}`;
}

const RELEVANCE_SYSTEM_PROMPT = `你是文件分類員，只負責判斷使用者上傳的文件是不是「交友媒合服務定型化契約」，不做任何法規檢核。

交友媒合服務契約的常見特徵（不必全部出現）：
- 約定媒合對象、排約、介紹見面等媒合服務內容。
- 會員資格、會員等級或會員權益的約定。
- 服務期間、服務次數或有效期限。
- 費用、付款方式、分期。
- 退費、解約、猶豫期的約定。

規則：
1. 只依看得到的內容判斷，不要臆測看不到的部分。
2. 只有在內容明顯屬於其他類型文件（例如發票、履歷、租賃契約、一般商品買賣契約、與交友媒合完全無關的文章或圖片）時，才把 isTargetContract 設為 false，並把 confidence 設為 high。
3. 內容模糊、片段不完整、看起來像契約但特徵不足以確定、或者根本無法判讀（例如影像模糊、文字亂碼）時，一律把 confidence 設為 low，這種情況即使覺得不像也不能設 confidence 為 high——判斷不出來就是 low，不是「傾向不是」。
4. hasMainContract 表示這次的內容裡**有沒有契約正本**。交友契約常拆成好幾份文件，例如「服務合約書」加上「消費借貸告知確認書」「附件」「告知同意書」。只看到附件或確認書、沒有看到訂定服務內容與雙方權利義務的本文時，把 hasMainContract 設為 false，confidence 設為 high。看到本文、或不確定，一律設為 true。
5. documentType 用一個簡短詞語描述你看到的文件類型（例如「租賃契約」「發票」「交友媒合服務契約」「消費借貸告知確認書」），看不出來就填「無法判斷」。
6. reason 限一句話。
7. 只輸出一個 JSON 物件，不要輸出 JSON 以外的任何文字或說明，格式固定如下：
{"isTargetContract": true 或 false, "hasMainContract": true 或 false, "confidence": "high" 或 "low", "documentType": "文件類型", "reason": "一句話理由"}`;

function buildRelevanceMessages(sampleText: string, image: ExtractedImage | null): ChatMessage[] {
  const parts: ChatContentPart[] = [];
  if (sampleText.trim().length > 0) {
    parts.push({ type: 'text', text: `【文件內容摘錄】\n${sampleText}` });
  }
  if (image) {
    parts.push({ type: 'text', text: '【文件影像（第一頁）】' });
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.data.toString('base64')}` },
    });
  }
  return [
    { role: 'system', content: RELEVANCE_SYSTEM_PROMPT },
    { role: 'user', content: parts },
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 解析模型回應，缺必要欄位或不是合法 JSON 一律拋出，由呼叫端接住並保守放行。 */
function parseRelevanceResult(content: string): RelevanceCheckResult {
  const json = JSON.parse(content) as Partial<RelevanceCheckResult>;
  if (typeof json.isTargetContract !== 'boolean') {
    throw new Error('回應缺少 isTargetContract 欄位。');
  }
  // confidence 只認得到 "high" 才算 high，其餘一律當作 low（含缺欄位、拼錯值），
  // 對應規則「判斷不出來時要回 confidence: low」，這裡連模型自己給錯格式都當成 low。
  const confidence = json.confidence === 'high' ? 'high' : 'low';
  return {
    isTargetContract: json.isTargetContract,
    // 沒給或給錯型別時一律當成「有正本」，維持放行的保守方向。
    hasMainContract: json.hasMainContract === false ? false : true,
    confidence,
    documentType: typeof json.documentType === 'string' ? json.documentType : '',
    reason: typeof json.reason === 'string' ? json.reason : '',
  };
}

/**
 * 判斷這份文件是不是交友媒合服務契約。
 *
 * 呼叫失敗（AI 掛掉、逾時、回應非 JSON、缺必要欄位）一律回傳
 * `fallbackAllowResult`（視為目標契約、confidence 為 low），不拋出例外，
 * 呼叫端不需要另外包 try/catch 才能安全使用。
 */
export async function checkRelevance(input: CheckRelevanceInput): Promise<RelevanceCheckResult> {
  const hasImages = input.contractImages.length > 0;
  const sampleText = hasImages ? '' : sampleContractText(input.contractText);
  const image = hasImages ? input.contractImages[0] : null;

  if (!hasImages && sampleText.trim().length === 0) {
    // 理論上不會發生（呼叫端已檢查過至少有檔案或貼上文字），但沒有任何
    // 可供判讀的內容時沒有分類的依據，保守放行。
    return fallbackAllowResult('沒有可供判讀的內容，保守放行。');
  }

  const messages = buildRelevanceMessages(sampleText, image);

  try {
    const result = await callGateway({
      baseUrl: input.gateway.baseUrl,
      apiKey: input.gateway.apiKey,
      model: input.gateway.model,
      messages,
      clientId: input.gateway.clientId,
      feature: input.gateway.feature,
      timeoutMs: 15000,
      maxOutputTokens: 300,
    });
    return parseRelevanceResult(result.content);
  } catch (error) {
    return fallbackAllowResult(`偵測失敗，保守放行：${errorMessage(error)}`);
  }
}
