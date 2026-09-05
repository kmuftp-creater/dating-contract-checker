/**
 * Office 文件抽取：Word（docx）用 mammoth，Excel（xlsx、xls）用 SheetJS。
 */

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { ExtractResult } from '@/lib/types';

/**
 * 抽取 Word 文件的純文字，保留段落換行。
 *
 * @param buffer docx 原始位元組。
 * @param filename 原始檔名，供錯誤訊息使用。
 */
export async function extractWord(buffer: Buffer, filename: string): Promise<ExtractResult> {
  const result = await mammoth.extractRawText({ buffer });
  const notes = result.messages
    .filter((message) => message.type === 'error')
    .map((message) => `${filename}：${message.message}`);

  return {
    text: result.value,
    images: [],
    method: 'text',
    pageCount: 1,
    notes,
  };
}

/**
 * 抽取 Excel 活頁簿，把每個工作表轉成有表頭的文字表格，
 * 並在文字中標明工作表名稱，讓模型讀得懂哪個工作表、哪一列。
 *
 * @param buffer xlsx 或 xls 原始位元組。
 * @param filename 原始檔名，供錯誤訊息使用。
 */
export async function extractExcel(buffer: Buffer, filename: string): Promise<ExtractResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames;

  if (sheetNames.length === 0) {
    return {
      text: '',
      images: [],
      method: 'text',
      pageCount: 0,
      notes: [`${filename} 沒有任何工作表`],
    };
  }

  const sections = sheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    return `【工作表：${name}】\n${csv.trim()}`;
  });

  return {
    text: sections.join('\n\n'),
    images: [],
    method: 'text',
    pageCount: sheetNames.length,
    notes: [],
  };
}
