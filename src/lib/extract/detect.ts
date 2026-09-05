/**
 * 檔案類型判斷。
 *
 * 優先看檔頭的魔術位元組，副檔名只作輔助（部分格式如 docx、xlsx
 * 本質上都是 zip，光看魔術位元組無法區分，必須靠副檔名）。
 */

import type { FileCategory } from '@/lib/types';

/** 判斷結果的細分格式，供各抽取模組使用。 */
export type DetectedFormat =
  | 'jpeg'
  | 'png'
  | 'bmp'
  | 'heic'
  | 'heif'
  | 'pdf'
  | 'txt'
  | 'docx'
  | 'xlsx'
  | 'xls';

const FORMAT_TO_CATEGORY: Record<DetectedFormat, FileCategory> = {
  jpeg: 'image',
  png: 'image',
  bmp: 'image',
  heic: 'image',
  heif: 'image',
  pdf: 'pdf',
  txt: 'text',
  docx: 'word',
  xlsx: 'excel',
  xls: 'excel',
};

/** 取副檔名（小寫，不含點號）。取不到時回傳空字串。 */
function getExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename);
  return match ? match[1].toLowerCase() : '';
}

/**
 * 依魔術位元組判斷細分格式。判斷不出來時回傳 null，交由副檔名輔助判斷。
 */
function detectByMagicBytes(buffer: Buffer): DetectedFormat | null {
  if (buffer.length < 12) {
    return null;
  }

  // JPEG：FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG：89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // BMP：42 4D（"BM"）
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'bmp';
  }

  // PDF：25 50 44 46（"%PDF"）
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'pdf';
  }

  // HEIC／HEIF：ISO base media file format，第 4 到 7 位元組為 "ftyp"，
  // 接著的 major brand 決定是 heic 系列還是 heif 系列。
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx') {
      return 'heic';
    }
    if (brand === 'mif1' || brand === 'msf1' || brand === 'heif') {
      return 'heif';
    }
  }

  // XLSX、DOCX（Office Open XML）：本質是 ZIP，魔術位元組為 50 4B 03 04，
  // 無法只靠位元組區分兩者，交由副檔名判斷。
  // XLS（舊版 Office，OLE2 複合檔）：D0 CF 11 E0 A1 B1 1A E1。

  return null;
}

/**
 * 判斷上傳檔案的類別。回傳 null 表示不支援的類型。
 *
 * @param filename 原始檔名，用於取得副檔名作為輔助判斷依據。
 * @param buffer 檔案內容，用於讀取魔術位元組。
 */
export function detectCategory(filename: string, buffer: Buffer): FileCategory | null {
  const format = detectFormat(filename, buffer);
  return format ? FORMAT_TO_CATEGORY[format] : null;
}

/** 判斷細分格式（供 index.ts 分派實際的抽取函式使用）。 */
export function detectFormat(filename: string, buffer: Buffer): DetectedFormat | null {
  const byMagic = detectByMagicBytes(buffer);
  const ext = getExtension(filename);

  if (byMagic) {
    // BMP 與 PDF、JPEG、PNG、HEIC 的魔術位元組具區別性，直接採用。
    return byMagic;
  }

  // ZIP 容器（docx、xlsx）與 OLE2 容器（xls）光靠位元組無法區分細節，
  // 用副檔名輔助判斷；純文字檔沒有固定魔術位元組，同樣靠副檔名。
  const isZipContainer =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);

  const isOle2Container =
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1;

  if (isZipContainer) {
    if (ext === 'docx') return 'docx';
    if (ext === 'xlsx') return 'xlsx';
    return null;
  }

  if (isOle2Container) {
    if (ext === 'xls') return 'xls';
    return null;
  }

  // 純文字檔沒有魔術位元組可辨識，只能靠副檔名。
  if (ext === 'txt') {
    return 'txt';
  }

  return null;
}
