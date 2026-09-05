import Link from 'next/link';
import { cookies, headers } from 'next/headers';

import { ResultView } from '@/components/result/result-view';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import type { AnalysisDetailResponse } from '@/lib/api-contract';
import { CLIENT_ID_COOKIE } from '@/lib/api-contract';

/**
 * 單筆分析結果。
 *
 * 這是伺服器元件：掛載前先在伺服器端呼叫 `GET /api/analyses/[id]`
 * 把結果內嵌進第一次繪製的 HTML，理由是分析失敗或已完成時，使用者
 * （與不執行前端 JavaScript 的驗證腳本）應該一開啟就看得到內容，
 * 不必等瀏覽器另外發一次請求才顯示。若當下仍在排隊或處理中，
 * `ResultView`（用戶端元件）掛載後會接手輪詢直到完成。
 *
 * 呼叫自己的 API 而非直接匯入 `src/lib/analyses.ts`：前台一律透過
 * `src/lib/api-contract.ts` 定義的 HTTP 介面存取資料，維持前後端的
 * 唯一溝通管道一致，也是 `src/lib/client/api.ts` 存在的理由。
 */

async function fetchAnalysisDetail(id: string): Promise<AnalysisDetailResponse | null> {
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3400';
  const cookieStore = await cookies();
  const ccid = cookieStore.get(CLIENT_ID_COOKIE)?.value;

  try {
    const response = await fetch(`http://${host}/api/analyses/${encodeURIComponent(id)}`, {
      headers: ccid ? { Cookie: `${CLIENT_ID_COOKIE}=${ccid}` } : {},
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as AnalysisDetailResponse;
  } catch {
    return null;
  }
}

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await fetchAnalysisDetail(id);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Link href="/history" className="text-sm text-brand hover:underline">
          ← 回歷史紀錄
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">分析結果</h1>

        {detail ? (
          <ResultView id={id} initialDetail={detail} />
        ) : (
          <p className="card mt-6 p-6 text-danger">
            查無資料：找不到這筆分析紀錄，可能已被刪除、超過保留期限，或網址有誤。
          </p>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
