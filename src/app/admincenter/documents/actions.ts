'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/auth';
import { parsePublishedAtDate, runAction } from '@/lib/action-result';
import type { ActionResult } from '@/lib/action-result';
import { createDraft, getPublished, getVersion, publish, setSource } from '@/lib/documents';
import type { DocumentKind } from '@/lib/types';

/**
 * 後台「法規文件」編輯頁的伺服器動作。
 *
 * 兩個動作都先重新核對登入狀態：Server Action 是一個可被直接呼叫的
 * POST 端點，不能只靠「頁面有沒有渲染出按鈕」把關，見 Next.js 文件
 * 的 Data Security 一節。
 */

/** 傳回用戶端的版本資料：時間欄位轉成 ISO 字串，避免序列化的疑慮。 */
export interface DocumentVersionView {
  id: string;
  version: number;
  markdown: string;
  attachmentPath: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  note: string | null;
  createdAt: string;
}

export type { ActionResult };

async function assertAdmin(): Promise<void> {
  const user = await requireAdmin();
  if (!user) {
    throw new Error('未登入或不在白名單內，無法執行此操作。');
  }
}

function toView(row: {
  id: string;
  version: number;
  markdown: string;
  attachmentPath: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  isPublished: boolean;
  publishedAt: Date | null;
  note: string | null;
  createdAt: Date;
}): DocumentVersionView {
  return {
    id: row.id,
    version: row.version,
    markdown: row.markdown,
    attachmentPath: row.attachmentPath,
    sourceUrl: row.sourceUrl,
    sourceLabel: row.sourceLabel,
    isPublished: row.isPublished,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 空字串視為「沒有備註」，存 null 而不是空字串。 */
function normalizeNote(note: string): string | undefined {
  const trimmed = note.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * 儲存草稿：新增一個版本，不影響目前生效版本。
 *
 * 版本號已存在時會覆蓋那一版的內容，**但生效中的版本除外**：儲存草稿
 * 的語意是「還沒要上線」，若讓它覆蓋生效版本，前台會在管理員沒按發布的
 * 情況下就換了內容。那種情況請改用「發布為生效版本」。
 */
export async function saveDraftAction(
  kind: DocumentKind,
  markdown: string,
  note: string,
  /** 指定版本號。留空代表沿用自動編號（目前最大值加一）。 */
  version?: number,
): Promise<ActionResult<DocumentVersionView>> {
  return runAction(async () => {
    await assertAdmin();
    if (markdown.trim() === '') {
      throw new Error('內容不能是空白，無法儲存草稿。');
    }

    if (version !== undefined) {
      const current = await getPublished(kind);
      if (current && current.version === version) {
        throw new Error(
          `第 ${version} 版目前是生效版本。儲存草稿不會覆蓋生效中的內容，` +
            `要更新它請改按「發布為生效版本」，或改用其他版本號存成草稿。`,
        );
      }
    }

    const draft = await createDraft(kind, markdown, normalizeNote(note), version, {
      replaceExisting: true,
    });
    revalidatePath(`/admincenter/documents/${kind}`);
    revalidatePath('/admincenter/documents');
    return toView(draft);
  });
}

/**
 * 以目前內容建立新版本並立即發布，取代原本的生效版本。
 *
 * 版本號已存在時，覆蓋那一版的內容再發布——官方改了第 1 版的內容但版號
 * 沒動時，管理員必須能用同一個版號蓋過去，否則系統裡的版號會跟官方對不起來。
 * 覆蓋不保留舊內容。
 *
 * 這是不可逆的狀態變更，前台的分析從此改採這個新版本；用戶端在呼叫前
 * 已經要求管理員二次確認（版本號已存在時，確認文字會明講這次是覆蓋），
 * 這裡不再重複詢問，但仍會重新驗證登入狀態。
 */
export async function publishAction(
  kind: DocumentKind,
  markdown: string,
  note: string,
  /** 指定版本號。留空代表沿用自動編號。 */
  version?: number,
  /** 指定生效日期（YYYY-MM-DD）。留空代表用發布當下的時間。 */
  publishedAtDate?: string,
): Promise<ActionResult<DocumentVersionView>> {
  return runAction(async () => {
    await assertAdmin();
    if (markdown.trim() === '') {
      throw new Error('內容不能是空白，無法發布。');
    }

    const publishedAt = parsePublishedAtDate(publishedAtDate);

    const draft = await createDraft(kind, markdown, normalizeNote(note), version, {
      replaceExisting: true,
    });
    const published = await publish(draft.id, publishedAt);
    revalidatePath(`/admincenter/documents/${kind}`);
    revalidatePath('/admincenter/documents');
    revalidatePath('/regulations');
    return toView(published);
  });
}

/**
 * 設定官方來源網址與顯示名稱，寫在目前生效版本上：前台 `/regulations`
 * 頁顯示的是生效版本的連結，草稿版本不會被前台讀到，所以來源連結不需要
 * 跟著草稿走。
 */
export async function setSourceAction(
  documentId: string,
  sourceUrl: string,
  sourceLabel: string,
): Promise<ActionResult<DocumentVersionView>> {
  return runAction(async () => {
    await assertAdmin();
    await setSource(documentId, sourceUrl, sourceLabel);

    const updated = await getVersion(documentId);
    if (!updated) {
      throw new Error(`找不到 id 為 ${documentId} 的法規文件版本。`);
    }

    revalidatePath(`/admincenter/documents/${updated.kind}`);
    revalidatePath('/regulations');
    return toView(updated);
  });
}
