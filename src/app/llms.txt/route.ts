import { NextResponse } from 'next/server';

import { getPublishedPair } from '@/lib/documents';
import { PUBLIC_PATHS, SITE_DESCRIPTION, SITE_NAME, getOperatorName, getSiteUrl } from '@/lib/site';

/**
 * `/llms.txt`：依 llmstxt.org 的格式，給 AI 助理與 RAG 系統一份濃縮的
 * 服務說明，取代它們自己爬全站再猜測的做法。
 *
 * 目錄名稱直接叫 `llms.txt`（含副檔名字面），Next.js 的路由是照目錄
 * 結構對應網址，資料夾名稱本身就是路徑片段，所以這裡會產生 `/llms.txt`
 * 這個網址，不需要額外設定。
 *
 * `force-dynamic` 的理由與 `sitemap.ts` 相同：`getSiteUrl()` 要在執行期
 * 求值，且下面會查資料庫。
 */
export const dynamic = 'force-dynamic';

/** 公開頁面在 llms.txt 裡的顯示名稱與一句說明。 */
const PAGE_LABELS: Record<(typeof PUBLIC_PATHS)[number], string> = {
  '/': '首頁',
  '/regulations': '法規文件',
  '/faq': '常見問題',
  '/terms': '服務條款',
  '/privacy': '隱私權政策',
};

const PAGE_DESCRIPTIONS: Record<(typeof PUBLIC_PATHS)[number], string> = {
  '/': '上傳或貼上交友媒合服務契約內容，取得逐條檢核報告，免費、不需註冊。',
  '/regulations': '目前生效的「交友媒合服務定型化契約查核表」與「交友媒合服務定型化契約應記載及不得記載事項」全文。',
  '/faq': '交友媒合服務契約的審閱期、退費、手續費與違約金上限、入會費、履約保障等九個常見問題，每題附條文出處。',
  '/terms': '本服務的使用範圍與責任限制。',
  '/privacy': '上傳的合約內容與個人資料會被如何蒐集、使用、保留與刪除。',
};

export async function GET() {
  const siteUrl = getSiteUrl();
  const operatorName = getOperatorName();

  const lines: string[] = [];

  lines.push(`# ${SITE_NAME}`);
  lines.push('');
  lines.push(`> ${SITE_DESCRIPTION}`);
  lines.push('');

  lines.push('## 服務用途');
  lines.push(
    '依內政部公告的「交友媒合服務定型化契約查核表」與「交友媒合服務定型化契約應記載及不得記載事項」，逐條檢查使用者提供的交友媒合服務契約，指出違反規定的地方並提供改善方式。判定由 AI 產生，屬於自行檢查用的參考。',
  );
  lines.push('');

  lines.push('## 查核依據與生效日');
  lines.push(
    '「交友媒合服務定型化契約應記載及不得記載事項」由中華民國內政部於 115 年 5 月 8 日公告，自 115 年 9 月 1 日生效。',
  );
  lines.push('');

  lines.push('## 適用範圍');
  lines.push(
    '僅適用於 115 年 9 月 1 日（含）以後簽訂、提供實體交友媒合服務並收取費用的定型化契約。在那之前簽訂的契約，仍應依照當時有效的法規標準辦理，本工具的檢核結果不適用。',
  );
  lines.push('');

  lines.push('## 限制與免責');
  lines.push(
    '檢核結果不等於主管機關的查核結果，也不構成法律意見，一切以內政部與地方主管機關公告的內容及其認定為準。本站只檢查交友媒合服務契約，不適用其他類型的文件。',
  );
  lines.push('');

  if (operatorName) {
    lines.push('## 營運單位');
    lines.push(operatorName);
    lines.push('');
  }

  lines.push('## 公開頁面');
  for (const path of PUBLIC_PATHS) {
    lines.push(`- [${PAGE_LABELS[path]}](${siteUrl}${path})：${PAGE_DESCRIPTIONS[path]}`);
  }
  lines.push('');

  try {
    const { checklist, regulation } = await getPublishedPair();
    const sourceLines: string[] = [];
    if (checklist?.sourceUrl) {
      sourceLines.push(`- [交友媒合服務定型化契約查核表](${checklist.sourceUrl})`);
    }
    if (regulation?.sourceUrl) {
      sourceLines.push(`- [交友媒合服務定型化契約應記載及不得記載事項](${regulation.sourceUrl})`);
    }
    if (sourceLines.length > 0) {
      lines.push('## 官方來源');
      lines.push(...sourceLines);
      lines.push('');
    }
  } catch {
    // 資料庫讀不到時仍要回 200，只是省略這個取自資料庫的段落。
  }

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
