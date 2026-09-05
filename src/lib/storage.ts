import 'server-only';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { env } from '@/lib/env';
import type {
  ArchiveResult,
  ExtractedImage,
  ExtractMethod,
  FileCategory,
} from '@/lib/types';

/**
 * 上傳檔案的磁碟存取。
 *
 * 分兩種生命週期：
 * - 「暫存」（`savePending` 等）：`POST /api/files` 抽取完成、但使用者
 *   還沒按「分析」前的暫時存放，不建立 `analyses` 紀錄（`analysisFiles.
 *   analysis_id` 是 not null，無法先建一筆空殼）。
 * - 「封存」（`saveArchive` 等）：`POST /api/analyses` 建立分析時，把暫存
 *   內容正式歸檔到以日期分子目錄的位置，路徑記在 `analysisFiles.
 *   storage_path`。
 *
 * 所有對外的「相對路徑」「檔案 id」都會先驗證格式，再組進絕對路徑，
 * 並確認結果沒有跳出 `env.uploadDir`，避免路徑穿越。使用者提供的原始檔名
 * 不會被用來組路徑，一律用系統產生的 uuid。
 */

const UPLOAD_ROOT = path.resolve(env.uploadDir);
const PENDING_DIR = path.join(UPLOAD_ROOT, 'pending');

/** 暫存檔的 id 格式固定是 uuid，避免被塞入路徑穿越字元。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * 把「相對於 uploadDir 的路徑」轉成絕對路徑，並確認沒有跳出 uploadDir。
 * 任何解析後不在 uploadDir 底下的路徑一律視為不合法，直接拋錯。
 */
function resolveWithin(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error('偵測到不安全的檔案路徑，已拒絕存取。');
  }
  return resolved;
}

function assertFileId(fileId: string): void {
  if (!UUID_PATTERN.test(fileId)) {
    throw new Error('檔案 id 格式不正確。');
  }
}

/** 依台北時間切出 `YYYY/MM/DD` 子目錄，三段各自補零。 */
function taipeiDateSegments(date: Date = new Date()): [string, string, string] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = formatter.format(date).split('-');
  return [year, month, day];
}

// ---------------------------------------------------------------------------
// 暫存（上傳完成、尚未建立分析）
// ---------------------------------------------------------------------------

/** 暫存內容的中繼資料，回傳給呼叫端組出 `UploadFileResponse`。 */
export interface PendingFileMeta {
  fileId: string;
  originalName: string;
  mime: string;
  size: number;
  category: FileCategory;
  extractMethod: ExtractMethod;
  pageCount: number;
  notes: string[];
}

export interface SavePendingInput {
  originalName: string;
  /** 原始檔案的 MIME 類型（依偵測到的格式判斷，不是封存後的類型）。 */
  mime: string;
  /** 原始檔案大小（位元組）。 */
  size: number;
  category: FileCategory;
  extractMethod: ExtractMethod;
  pageCount: number;
  notes: string[];
  /** 抽出的純文字，無文字內容時為空字串。 */
  text: string;
  /** 走影像辨識路徑時的圖片，其餘為空陣列。 */
  images: ExtractedImage[];
  /** 封存用的轉檔結果，供之後 `saveArchive` 落地使用。 */
  archive: ArchiveResult;
}

export interface PendingBundle {
  meta: PendingFileMeta;
  text: string;
  images: ExtractedImage[];
  archive: ArchiveResult;
}

interface PendingFileOnDisk {
  originalName: string;
  mime: string;
  size: number;
  category: FileCategory;
  extractMethod: ExtractMethod;
  pageCount: number;
  notes: string[];
  text: string;
  images: { label: string; width: number; height: number; dataBase64: string }[];
  archive: { mime: string; extension: string; converted: boolean; dataBase64: string };
  createdAt: string;
}

function pendingPath(fileId: string): string {
  assertFileId(fileId);
  return resolveWithin(PENDING_DIR, `${fileId}.json`);
}

/**
 * 把 `POST /api/files` 抽取完成的內容存到磁碟，回傳新產生的檔案 id
 * 與可直接組成 `UploadFileResponse` 的中繼資料。
 */
export async function savePending(input: SavePendingInput): Promise<PendingFileMeta> {
  await ensureDir(PENDING_DIR);
  const fileId = randomUUID();

  const onDisk: PendingFileOnDisk = {
    originalName: input.originalName,
    mime: input.mime,
    size: input.size,
    category: input.category,
    extractMethod: input.extractMethod,
    pageCount: input.pageCount,
    notes: input.notes,
    text: input.text,
    images: input.images.map((image) => ({
      label: image.label,
      width: image.width,
      height: image.height,
      dataBase64: image.data.toString('base64'),
    })),
    archive: {
      mime: input.archive.mime,
      extension: input.archive.extension,
      converted: input.archive.converted,
      dataBase64: input.archive.data.toString('base64'),
    },
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(pendingPath(fileId), JSON.stringify(onDisk), 'utf8');

  return {
    fileId,
    originalName: input.originalName,
    mime: input.mime,
    size: input.size,
    category: input.category,
    extractMethod: input.extractMethod,
    pageCount: input.pageCount,
    notes: input.notes,
  };
}

/** 讀回暫存內容；檔案不存在或格式毀損時回傳 null。 */
export async function readPending(fileId: string): Promise<PendingBundle | null> {
  let raw: string;
  try {
    raw = await fs.readFile(pendingPath(fileId), 'utf8');
  } catch {
    return null;
  }

  let onDisk: PendingFileOnDisk;
  try {
    onDisk = JSON.parse(raw) as PendingFileOnDisk;
  } catch {
    return null;
  }

  return {
    meta: {
      fileId,
      originalName: onDisk.originalName,
      mime: onDisk.mime,
      size: onDisk.size,
      category: onDisk.category,
      extractMethod: onDisk.extractMethod,
      pageCount: onDisk.pageCount,
      notes: onDisk.notes,
    },
    text: onDisk.text,
    images: onDisk.images.map((image) => ({
      data: Buffer.from(image.dataBase64, 'base64'),
      mime: 'image/jpeg' as const,
      label: image.label,
      width: image.width,
      height: image.height,
    })),
    archive: {
      data: Buffer.from(onDisk.archive.dataBase64, 'base64'),
      mime: onDisk.archive.mime,
      extension: onDisk.archive.extension,
      converted: onDisk.archive.converted,
    },
  };
}

/** 刪除暫存內容。檔案不存在時視為成功，不拋錯。 */
export async function deletePending(fileId: string): Promise<void> {
  try {
    await fs.unlink(pendingPath(fileId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// 封存（已歸屬到某筆分析）
// ---------------------------------------------------------------------------

/**
 * 把封存結果落地，回傳相對於 `uploadDir` 的路徑（例如
 * `2026/09/04/<analysisId>/<uuid>.webp`），存進 `analysisFiles.storagePath`。
 */
export async function saveArchive(archive: ArchiveResult, analysisId: string): Promise<string> {
  const [year, month, day] = taipeiDateSegments();
  const relativeDir = path.posix.join(year, month, day, analysisId);
  const absoluteDir = resolveWithin(UPLOAD_ROOT, relativeDir);
  await ensureDir(absoluteDir);

  const filename = `${randomUUID()}${archive.extension}`;
  const relativePath = path.posix.join(relativeDir, filename);
  await fs.writeFile(resolveWithin(UPLOAD_ROOT, relativePath), archive.data);

  return relativePath;
}

/** 讀回封存的原始位元組。 */
export async function readArchive(relativePath: string): Promise<Buffer> {
  return fs.readFile(resolveWithin(UPLOAD_ROOT, relativePath));
}

/** 刪除封存檔（原始檔保留期滿後由清理排程呼叫），連同可能存在的圖片附掛檔一併刪除。 */
export async function deleteArchive(relativePath: string): Promise<void> {
  const absolute = resolveWithin(UPLOAD_ROOT, relativePath);
  try {
    await fs.unlink(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  await deleteContractImages(relativePath);
}

// ---------------------------------------------------------------------------
// 問題回報截圖
// ---------------------------------------------------------------------------

/**
 * 把問題回報附的截圖存到磁碟，回傳相對於 `uploadDir` 的路徑
 * （例如 `reports/2026/09/05/<reportId>.webp`），存進 `reports.screenshotPath`。
 *
 * 檔名直接用 `reportId`（呼叫端已插入資料庫、取得的 uuid，經
 * `assertFileId` 驗證格式）：一筆回報最多一張截圖，不需要另外產生亂數
 * 檔名。讀取沿用既有的 `readArchive`，不需要另外的讀取函式。
 */
export async function saveReportScreenshot(
  data: Buffer,
  extension: string,
  reportId: string,
): Promise<string> {
  assertFileId(reportId);
  const [year, month, day] = taipeiDateSegments();
  const relativeDir = path.posix.join('reports', year, month, day);
  const absoluteDir = resolveWithin(UPLOAD_ROOT, relativeDir);
  await ensureDir(absoluteDir);

  const relativePath = path.posix.join(relativeDir, `${reportId}${extension}`);
  await fs.writeFile(resolveWithin(UPLOAD_ROOT, relativePath), data);

  return relativePath;
}

/** 刪除問題回報的截圖檔案。檔案不存在時視為成功，不拋錯。 */
export async function deleteReportScreenshot(relativePath: string): Promise<void> {
  const absolute = resolveWithin(UPLOAD_ROOT, relativePath);
  try {
    await fs.unlink(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// 影像辨識用的圖片（與封存檔同目錄的附掛檔）
// ---------------------------------------------------------------------------

interface ContractImagesOnDisk {
  images: { label: string; width: number; height: number; dataBase64: string }[];
}

function contractImagesPath(storagePath: string): string {
  return resolveWithin(UPLOAD_ROOT, `${storagePath}.images.json`);
}

/**
 * 把走影像辨識路徑的圖片（送給模型用的 JPEG，非封存用的 WebP）存成
 * `storagePath` 的附掛檔。沒有圖片時不寫檔。
 */
export async function saveContractImages(
  images: ExtractedImage[],
  storagePath: string,
): Promise<void> {
  if (images.length === 0) {
    return;
  }
  const onDisk: ContractImagesOnDisk = {
    images: images.map((image) => ({
      label: image.label,
      width: image.width,
      height: image.height,
      dataBase64: image.data.toString('base64'),
    })),
  };
  await fs.writeFile(contractImagesPath(storagePath), JSON.stringify(onDisk), 'utf8');
}

/** 讀回 `saveContractImages` 存的圖片；沒有附掛檔時回傳空陣列。 */
export async function readContractImages(storagePath: string): Promise<ExtractedImage[]> {
  let raw: string;
  try {
    raw = await fs.readFile(contractImagesPath(storagePath), 'utf8');
  } catch {
    return [];
  }

  try {
    const onDisk = JSON.parse(raw) as ContractImagesOnDisk;
    return onDisk.images.map((image) => ({
      data: Buffer.from(image.dataBase64, 'base64'),
      mime: 'image/jpeg' as const,
      label: image.label,
      width: image.width,
      height: image.height,
    }));
  } catch {
    return [];
  }
}

async function deleteContractImages(storagePath: string): Promise<void> {
  try {
    await fs.unlink(contractImagesPath(storagePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// 清理過期檔案
// ---------------------------------------------------------------------------

/** 遞迴列出目錄底下所有一般檔案的絕對路徑；目錄不存在時回傳空陣列。 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 刪除超過保留天數的檔案：暫存區直接依檔案存在時間清；封存區依日期子目錄
 * 底下所有檔案（不含 `.images.json` 附掛檔，附掛檔隨主檔一併刪除）逐一
 * 檢查修改時間。回傳實際刪除的「檔案項目」數（暫存一筆或封存一個主檔
 * 各算一筆，附掛的圖片檔不另計）。
 */
export async function purgeExpired(days: number): Promise<number> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let deleted = 0;

  const pendingFiles = await listFilesRecursive(PENDING_DIR);
  for (const file of pendingFiles) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.unlink(file).catch(() => undefined);
      deleted += 1;
    }
  }

  const allArchiveFiles = await listFilesRecursive(UPLOAD_ROOT);
  for (const file of allArchiveFiles) {
    if (file.startsWith(`${PENDING_DIR}${path.sep}`) || file === PENDING_DIR) {
      continue;
    }
    if (file.endsWith('.images.json')) {
      // 隨對應的主檔一併處理，不在這裡單獨判斷與計數。
      continue;
    }

    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.unlink(file).catch(() => undefined);
      await fs.unlink(`${file}.images.json`).catch(() => undefined);
      deleted += 1;
    }
  }

  return deleted;
}
