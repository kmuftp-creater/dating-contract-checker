/**
 * 純文字檔抽取：偵測編碼並解成字串。
 *
 * 支援 UTF-8（含 BOM）與 Big5。Node 24 的 TextDecoder 內建 Big5
 * 解碼器（由 ICU 提供），實測可用，不需額外套件。
 */

import type { ExtractResult } from '@/lib/types';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * 粗略判斷 buffer 是否為合法 UTF-8：
 * 逐位元組檢查多位元組序列是否符合 UTF-8 規則。
 * Big5 的高位元組序列不符合 UTF-8 規則，可藉此區分兩者。
 */
function isValidUtf8(buffer: Buffer): boolean {
  let i = 0;
  while (i < buffer.length) {
    const byte = buffer[i];
    if (byte <= 0x7f) {
      i += 1;
      continue;
    }
    let extraBytes: number;
    if ((byte & 0xe0) === 0xc0) {
      extraBytes = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      extraBytes = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      extraBytes = 3;
    } else {
      return false;
    }
    if (i + extraBytes >= buffer.length) {
      return false;
    }
    for (let j = 1; j <= extraBytes; j += 1) {
      if ((buffer[i + j] & 0xc0) !== 0x80) {
        return false;
      }
    }
    i += extraBytes + 1;
  }
  return true;
}

/** 解出純文字內容，偵測 UTF-8 與 Big5 兩種編碼。 */
function decodeText(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(UTF8_BOM)) {
    return new TextDecoder('utf-8').decode(buffer.subarray(3));
  }
  if (isValidUtf8(buffer)) {
    return new TextDecoder('utf-8').decode(buffer);
  }
  // 非合法 UTF-8，視為 Big5（台灣常見的合約檔編碼）。
  return new TextDecoder('big5').decode(buffer);
}

/**
 * 抽取純文字檔內容。
 *
 * @param buffer 檔案原始位元組。
 * @param filename 原始檔名，僅用於錯誤訊息。
 */
export async function extractText(buffer: Buffer, filename: string): Promise<ExtractResult> {
  if (buffer.length === 0) {
    return {
      text: '',
      images: [],
      method: 'text',
      pageCount: 1,
      notes: [`${filename} 內容為空`],
    };
  }

  const text = decodeText(buffer);

  return {
    text,
    images: [],
    method: 'text',
    pageCount: 1,
    notes: [],
  };
}
