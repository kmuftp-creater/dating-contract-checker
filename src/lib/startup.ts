import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db } from '@/db';
import { createDraft, getPublished, publish, setSource } from '@/lib/documents';
import type { DocumentKind } from '@/lib/types';

/**
 * 服務啟動時的資料庫準備工作：套用遷移、匯入初始法規文件。
 *
 * 為什麼放在啟動流程而不是靠人工跑腳本：容器映像檔裡沒有 tsx 也沒有
 * 驗證腳本（那些在建置時就被排除了），部署者沒有現成的方式執行匯入。
 * 對公開版尤其重要——民政局或其他單位自行部署時，不該還要先學會怎麼
 * 手動灌初始資料。
 *
 * 兩個動作都是冪等的：遷移只套用還沒套用過的，匯入只在該類別完全沒有
 * 生效版本時才做。重複啟動不會重複建立資料，也不會覆蓋管理員後來
 * 在後台更新的內容。
 */

/** 初始資料的來源檔。路徑相對於工作目錄，容器裡由 Dockerfile 複製過去。 */
const SEED_FILES: Record<DocumentKind, { file: string; label: string; url: string }> = {
  privacy: { file: 'privacy.md', label: '', url: '' },
  terms: { file: 'terms.md', label: '', url: '' },
  checklist: {
    file: 'checklist.md',
    label: '臺中市政府民政局公告（附件 2：縣市年交友媒合服務定型化契約查核表）',
    url: 'https://www.civil.taichung.gov.tw/21804/21807/21825/3321208',
  },
  regulation: {
    file: 'regulation.md',
    label: '消費者文教基金會轉載內政部公告全文',
    url: 'https://www.consumers.org.tw/product-detail-4082602.html',
  },
};

const KIND_NAMES: Record<DocumentKind, string> = {
  checklist: '查核表',
  regulation: '公告全文',
  privacy: '隱私權政策',
  terms: '服務條款',
};

/**
 * 套用尚未執行的資料庫遷移。
 *
 * 失敗就讓啟動失敗，不要帶著結構不完整的資料庫繼續跑：那樣第一個打進來
 * 的請求才會炸，而且錯誤訊息會指向無關的地方。
 */
export async function migrateDatabase(): Promise<void> {
  const migrationsFolder = path.join(process.cwd(), 'src', 'db', 'migrations');
  await migrate(db, { migrationsFolder });
  console.info('[啟動] 資料庫遷移已是最新');
}

/**
 * 匯入初始法規文件。
 *
 * 只在該類別「完全沒有生效版本」時才動作。找不到來源檔時只記錄警告不中斷：
 * 管理員仍可在後台自行貼上內容，沒有理由因為少一個檔案就讓整個服務起不來。
 */
export async function ensureSeedDocuments(): Promise<void> {
  for (const kind of Object.keys(SEED_FILES) as DocumentKind[]) {
    const existing = await getPublished(kind);
    if (existing) {
      continue;
    }

    const seed = SEED_FILES[kind];
    // 路徑前綴必須是靜態字面量，只有最後一段可以是變數，否則打包工具
    // 會判定為動態檔案存取而把整個專案打包進部署包（見 pdf.ts 的說明）。
    const filePath = path.join(process.cwd(), 'seed', seed.file);

    let markdown: string;
    try {
      markdown = await readFile(filePath, 'utf8');
    } catch {
      console.warn(
        `[啟動] 找不到 ${KIND_NAMES[kind]} 的初始資料（seed/${seed.file}），略過匯入。` +
          '請登入後台的「法規文件」頁自行貼上內容，否則前台無法進行分析。',
      );
      continue;
    }

    const draft = await createDraft(kind, markdown, '系統首次啟動時自動匯入');
    await publish(draft.id);
    // 隱私權政策與服務條款沒有官方來源，跳過設定連結。
    if (seed.url) {
      await setSource(draft.id, seed.url, seed.label);
    }
    console.info(`[啟動] 已匯入 ${KIND_NAMES[kind]} 第 ${draft.version} 版並發布`);
  }
}

/**
 * 啟動時的資料庫準備。遷移失敗會往外拋，匯入失敗只記錄不中斷。
 */
export async function prepareDatabase(): Promise<void> {
  await migrateDatabase();

  try {
    await ensureSeedDocuments();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[啟動] 初始法規文件匯入時發生問題，已略過：${detail}`);
  }
}
