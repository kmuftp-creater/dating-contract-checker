import 'server-only';

import { resolve, sep } from 'node:path';

import { and, desc, eq } from 'drizzle-orm';

import { db, schema } from '@/db';
import { env } from '@/lib/env';

import type { DocumentKind } from './types';

/**
 * 法規文件（查核表、公告全文）的資料存取層。
 *
 * 「生效版本」的定義：同一 kind 底下 `isPublished` 為 true 的那一筆。
 * 任何時刻，同一 kind 恰好有 0 或 1 筆生效版本；`publish()` 負責維持這個
 * 不變量，其餘函式只讀取或新增，不會破壞它。
 */

/** documents 資料表的一列。 */
export type DocumentRow = typeof schema.documents.$inferSelect;

/** 取得某類別目前生效的版本；沒有生效版本時回傳 null。 */
export async function getPublished(kind: DocumentKind): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.kind, kind), eq(schema.documents.isPublished, true)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 一次取回查核表與公告全文目前生效的版本，供 AI 分析流程使用：
 * 分析時要同時引用兩份文件，分兩次查詢徒增往返次數。
 */
export async function getPublishedPair(): Promise<{
  checklist: DocumentRow | null;
  regulation: DocumentRow | null;
}> {
  const [checklist, regulation] = await Promise.all([
    getPublished('checklist'),
    getPublished('regulation'),
  ]);
  return { checklist, regulation };
}

/** 列出某類別的所有版本，新到舊排序。 */
export async function listVersions(kind: DocumentKind): Promise<DocumentRow[]> {
  return db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.kind, kind))
    .orderBy(desc(schema.documents.version));
}

/** 依 id 取單一版本；找不到回傳 null。 */
export async function getVersion(id: string): Promise<DocumentRow | null> {
  const rows = await db.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface CreateDraftOptions {
  /**
   * 指定的版本號已經存在時，覆蓋那一版的內容，而不是拒絕。
   *
   * 為什麼需要這個：版本號是官方決定的，不是我們的流水號。官方把第 1 版
   * 的內容改了一次但版號沒動，管理員就必須能用同一個版號蓋掉舊內容——
   * 被迫改成第 2 版反而讓系統裡的版號與官方對不起來，那正是開放自訂版號
   * 要避免的事。
   *
   * 覆蓋會直接改掉那一版的內容，舊內容不保留。呼叫端負責讓管理員在動作
   * 之前就知道這件事（見後台編輯頁的確認核取方塊）。
   */
  replaceExisting?: boolean;
}

/**
 * 建立新草稿：版本號取該類別目前最大值加一（該類別尚無任何版本時為 1），
 * `isPublished` 固定為 false，不影響目前生效版本。
 *
 * 指定的版本號已存在時，預設拒絕；帶 `replaceExisting` 才會覆蓋那一版。
 * 覆蓋時不動該版的 `isPublished`：要不要生效由 `publish()` 決定，這個函式
 * 只負責內容。
 */
export async function createDraft(
  kind: DocumentKind,
  markdown: string,
  note?: string,
  /**
   * 指定版本號。留空則自動取目前最大值加一。
   *
   * 開放指定的理由：法規的版本編號是外部世界決定的，不是我們的流水號。
   * 官方發布第 3 版時，系統裡若剛好是第 5 版，兩邊對不起來會造成誤解。
   */
  version?: number,
  options: CreateDraftOptions = {},
): Promise<DocumentRow> {
  const versions = await listVersions(kind);
  const autoVersion =
    versions.length > 0 ? Math.max(...versions.map((v) => v.version)) + 1 : 1;
  const nextVersion = version ?? autoVersion;

  if (!Number.isInteger(nextVersion) || nextVersion < 1) {
    throw new Error(`版本號必須是 1 以上的整數，收到的是「${String(version)}」。`);
  }

  const existing = version !== undefined ? versions.find((v) => v.version === version) : undefined;
  if (existing) {
    if (!options.replaceExisting) {
      throw new Error(`第 ${version} 版已經存在，請改用其他版本號。`);
    }

    const [replaced] = await db
      .update(schema.documents)
      .set({ markdown, note: note ?? null })
      .where(eq(schema.documents.id, existing.id))
      .returning();
    return replaced;
  }

  const [row] = await db
    .insert(schema.documents)
    .values({
      kind,
      version: nextVersion,
      markdown,
      note: note ?? null,
      isPublished: false,
    })
    .returning();
  return row;
}

/**
 * 把某筆版本設為生效版本，同類別其他版本一併設為非生效。
 *
 * 整段包在一個交易裡：不會出現「新版本已生效、舊版本還沒撤下」或
 * 「舊版本已撤下、新版本還沒生效」這種同一 kind 有兩筆或零筆生效版本的
 * 中間狀態。
 */
export async function publish(id: string, publishedAt?: Date): Promise<DocumentRow> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw new Error(`找不到 id 為 ${id} 的法規文件版本，無法發布。`);
    }

    await tx
      .update(schema.documents)
      .set({ isPublished: false })
      .where(
        and(eq(schema.documents.kind, target.kind), eq(schema.documents.isPublished, true)),
      );

    const [updated] = await tx
      .update(schema.documents)
      .set({ isPublished: true, publishedAt: publishedAt ?? new Date() })
      .where(eq(schema.documents.id, id))
      .returning();
    return updated;
  });
}

/**
 * 設定某版本的官方原檔（PDF、DOCX）儲存路徑。
 *
 * 路徑必須落在上傳目錄之內。目前唯一的呼叫端是初始匯入腳本，傳進來的是
 * 程式自己組出的路徑，使用者影響不到；但只要後台之後加上「上傳原檔」的
 * 介面，這個參數就會變成使用者可控的輸入，而下載 API 會直接拿它去讀檔。
 * 防線寫在這裡，比等介面做出來再補可靠。
 */
export async function setAttachment(id: string, filePath: string): Promise<void> {
  assertInsideUploadDir(filePath);
  await db
    .update(schema.documents)
    .set({ attachmentPath: filePath })
    .where(eq(schema.documents.id, id));
}

/**
 * 設定某版本的官方來源網址與顯示名稱（2026-09-04 User 裁決：檔案下載改由
 * 官方網站提供，前台改顯示這個連結）。
 *
 * `sourceUrl` 會直接輸出到前台頁面當作可點擊連結，驗證不能省：只接受
 * `https://` 開頭的絕對網址，拒絕 `javascript:`、`data:` 等協定，避免
 * 之後有人把不安全的網址存進資料庫。傳空字串代表移除來源連結，
 * 此時 `sourceLabel` 一併清空。
 */
export async function setSource(
  id: string,
  sourceUrl: string,
  sourceLabel: string,
): Promise<void> {
  const trimmedUrl = sourceUrl.trim();

  if (trimmedUrl === '') {
    await db
      .update(schema.documents)
      .set({ sourceUrl: null, sourceLabel: null })
      .where(eq(schema.documents.id, id));
    return;
  }

  assertValidSourceUrl(trimmedUrl);

  const trimmedLabel = sourceLabel.trim();
  await db
    .update(schema.documents)
    .set({ sourceUrl: trimmedUrl, sourceLabel: trimmedLabel === '' ? null : trimmedLabel })
    .where(eq(schema.documents.id, id));
}

/** 確認網址是合法的 https 絕對網址，否則拋出中文錯誤。 */
export function assertValidSourceUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`官方來源網址格式不正確，必須是完整的網址：${value}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `官方來源網址必須以 https:// 開頭，收到的通訊協定為「${parsed.protocol}」：${value}`,
    );
  }
}

/**
 * 確認路徑解析後仍在上傳目錄底下，否則拋錯。
 *
 * 比對前先各自 resolve 成絕對路徑，才擋得掉 `..` 與符號連結以外的穿越寫法；
 * 比對時在目錄後面補上分隔符號，避免 `/data/uploads-evil` 被誤判成
 * `/data/uploads` 的子目錄。
 */
export function assertInsideUploadDir(filePath: string): void {
  const root = resolve(env.uploadDir);
  const target = resolve(root, filePath);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;

  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(
      `附加檔案的路徑必須位於上傳目錄之內，收到的路徑解析後落在目錄之外：${filePath}`,
    );
  }
}
