/**
 * 檔案抽取的對外入口。依偵測到的格式分派到各模組。
 */

import type { ExtractResult } from '@/lib/types';
import { detectFormat } from './detect';
import { extractImage } from './image';
import { extractPdf } from './pdf';
import { extractWord, extractExcel } from './office';
import { extractText } from './text';

export { detectCategory, detectFormat } from './detect';
export type { DetectedFormat } from './detect';
export { extractImage } from './image';
export { extractPdf } from './pdf';
export { extractWord, extractExcel } from './office';
export { extractText } from './text';
export { toArchive } from './archive';

/**
 * 依檔案內容自動判斷格式並抽取內容。
 *
 * @param buffer 檔案原始位元組。
 * @param filename 原始檔名，用於判斷格式與魔術位元組的輔助依據。
 * @param mime 選填的 MIME 類型，目前僅供未來擴充使用，判斷仍以
 *   `detectFormat` 的魔術位元組與副檔名為主。
 */
export async function extractFile(
  buffer: Buffer,
  filename: string,
  mime?: string,
): Promise<ExtractResult> {
  void mime;

  const format = detectFormat(filename, buffer);

  switch (format) {
    case 'jpeg':
    case 'png':
    case 'bmp':
    case 'heic':
    case 'heif':
      return extractImage(buffer, filename);
    case 'pdf':
      return extractPdf(buffer, filename);
    case 'docx':
      return extractWord(buffer, filename);
    case 'xlsx':
    case 'xls':
      return extractExcel(buffer, filename);
    case 'txt':
      return extractText(buffer, filename);
    default:
      throw new Error(`不支援的檔案類型：${filename}`);
  }
}
