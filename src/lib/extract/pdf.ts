/**
 * PDF 抽取：有文字層直接抽文字，掃描檔則逐頁算繪成圖片交給模型辨識。
 *
 * 用 pdfjs-dist 的 legacy build（Node 環境，非瀏覽器）。legacy build
 * 偵測到在 Node 執行時，會自動載入 @napi-rs/canvas 作為內建
 * CanvasFactory 並補上 DOMMatrix、Path2D 兩個 polyfill，不需要另外
 * 設定 worker（Node 沒有 Worker 全域物件時，pdfjs 會退回同執行緒的
 * fake worker，實測可行）。
 */

import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { ExtractedImage, ExtractResult } from '@/lib/types';

/** 頁數上限，超過只處理前 N 頁。 */
const PAGE_CAP = 30;

/** 判定掃描檔的門檻：平均每頁抽出的文字少於此值視為掃描檔。 */
const SCAN_THRESHOLD_CHARS_PER_PAGE = 50;

/** 掃描檔算繪成圖片時，最長邊的目標像素。 */
const SCAN_TARGET_LONG_EDGE = 2000;

/** 掃描檔算繪成圖片的 JPEG 品質。 */
const SCAN_JPEG_QUALITY = 90;

// pdfjs-dist 沒有在 package.json 宣告 exports 欄位限制子路徑，
// 可直接匯入 legacy build 的 ESM 進入點。動態匯入以避免頂層匯入
// 影響其他不需要 PDF 功能模組的載入時間。
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsModulePromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModulePromise;
}

/**
 * pdfjs-dist 套件目錄。
 *
 * 這裡踩過兩個坑，兩個都只在正式部署才發作，寫下來避免再繞一次：
 *
 * 1. **不能用 `require.resolve('pdfjs-dist/package.json')`**。打包工具會把
 *    靜態可分析的 `.resolve('字面量')` 改寫成內部模組編號（一個數字），
 *    執行時變成拿數字去組路徑，錯誤是
 *    「The "path" argument must be of type string. Received type number」。
 * 2. **也不能在執行時掃描目錄找它**。用 `existsSync` 逐層往上找雖然能動，
 *    但打包工具偵測到「動態檔案存取」後，會保守地把**整個專案**都算成
 *    可能用到的檔案一併打包，連 `data/`（上傳檔案）、`scripts/`、`docs/`
 *    都被塞進部署包。那不只是變肥，是把不該進映像檔的東西帶進去。
 *
 * 所以改成一條固定路徑：工作目錄底下的 node_modules。三種情境都成立，
 * 因為 Next.js 的獨立輸出會把相依套件放進輸出目錄自己的 node_modules：
 * 開發（工作目錄為專案根目錄）、獨立輸出（`.next/standalone`）、
 * 容器（`/app`）。
 *
 * 前提：`next.config.ts` 的 `outputFileTracingIncludes` 必須把 `cmaps/`
 * 與 `standard_fonts/` 列進去，否則它們不會出現在部署包裡。
 *
 * 補充第 2 點：路徑的**前綴必須是靜態可分析的**，只有最後一段可以是變數。
 * 曾經把基準路徑寫成 `process.env.PDFJS_DIR ?? path.join(...)`，
 * 打包工具無法判定它指向哪裡，同樣觸發整個專案被打包。
 * 那個環境變數覆寫是為了應付「萬一有特殊部署方式」的彈性，
 * 但它換來的代價是把所有原始碼與上傳資料塞進映像檔，不划算，因此拿掉。
 */

/**
 * 取得 pdfjs-dist 內建資源目錄的絕對路徑（結尾固定為正斜線）。
 *
 * pdfjs 內部以是否為 "/" 結尾判斷路徑格式是否合法，Windows 的
 * path.sep（反斜線）不被接受，故不可用 path.join 或 path.sep 組尾端。
 */
function resolvePdfjsAssetDir(subdir: string): string {
  const dir = path
    .join(process.cwd(), 'node_modules', 'pdfjs-dist', subdir)
    .split(path.sep)
    .join('/');
  return `${dir}/`;
}

/** 單一頁面的文字內容（trim 後）。 */
interface PageText {
  pageNumber: number;
  text: string;
}

/**
 * 抽取 PDF 內容。
 *
 * @param buffer PDF 原始位元組。
 * @param filename 原始檔名，用於圖片標籤。
 */
export async function extractPdf(buffer: Buffer, filename: string): Promise<ExtractResult> {
  const pdfjs = await loadPdfjs();
  const notes: string[] = [];

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: resolvePdfjsAssetDir('standard_fonts'),
    cMapUrl: resolvePdfjsAssetDir('cmaps'),
    cMapPacked: true,
    useSystemFonts: false,
  });

  const pdfDocument = await loadingTask.promise;

  try {
    const totalPages = pdfDocument.numPages;
    const pagesToProcess = Math.min(totalPages, PAGE_CAP);

    if (totalPages > PAGE_CAP) {
      notes.push(
        `PDF 共 ${totalPages} 頁，超過處理上限 ${PAGE_CAP} 頁，僅處理前 ${PAGE_CAP} 頁`,
      );
    }

    const pageTexts: PageText[] = [];
    for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join('')
        .trim();
      pageTexts.push({ pageNumber, text });
    }

    const totalChars = pageTexts.reduce((sum, p) => sum + p.text.length, 0);
    const avgCharsPerPage = pagesToProcess > 0 ? totalChars / pagesToProcess : 0;
    const isScanned = avgCharsPerPage < SCAN_THRESHOLD_CHARS_PER_PAGE;

    if (!isScanned) {
      const lowTextPages = pageTexts.filter((p) => p.text.length < SCAN_THRESHOLD_CHARS_PER_PAGE);
      if (lowTextPages.length > 0) {
        notes.push(
          `第 ${lowTextPages.map((p) => p.pageNumber).join('、')} 頁文字量偏低，可能含掃描或圖片內容；` +
            `整份文件平均每頁文字量高於門檻，已依文字層判定，該幾頁內容可能不完整`,
        );
      }

      const combinedText = pageTexts
        .map((p) => `【第 ${p.pageNumber} 頁】\n${p.text}`)
        .join('\n\n');

      return {
        text: combinedText,
        images: [],
        method: 'text',
        pageCount: totalPages,
        notes,
      };
    }

    const highTextPages = pageTexts.filter((p) => p.text.length >= SCAN_THRESHOLD_CHARS_PER_PAGE);
    if (highTextPages.length > 0) {
      notes.push(
        `第 ${highTextPages.map((p) => p.pageNumber).join('、')} 頁本身有文字層，但整份文件平均每頁文字量` +
          `低於門檻，已整份判定為掃描檔，全部頁面改用影像辨識`,
      );
    }

    const images: ExtractedImage[] = [];
    for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const longEdge = Math.max(baseViewport.width, baseViewport.height);
      const scale = longEdge > 0 ? SCAN_TARGET_LONG_EDGE / longEdge : 1;
      const viewport = page.getViewport({ scale });

      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');

      const renderTask = page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      });
      await renderTask.promise;

      const jpegBuffer = canvas.toBuffer('image/jpeg', SCAN_JPEG_QUALITY);
      images.push({
        data: jpegBuffer,
        mime: 'image/jpeg',
        label: `${filename} 第 ${pageNumber} 頁`,
        width: canvas.width,
        height: canvas.height,
      });
    }

    return {
      text: '',
      images,
      method: 'ocr',
      pageCount: totalPages,
      notes,
    };
  } finally {
    await loadingTask.destroy();
  }
}
