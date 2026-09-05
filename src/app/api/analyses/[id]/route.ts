import { NextResponse, type NextRequest } from 'next/server';

import { categoryFromMime, getForClient } from '@/lib/analyses';
import type { AnalysisDetailResponse, AnalysisFileSummary } from '@/lib/api-contract';
import { getVersion } from '@/lib/documents';
import { errorResponse, getOrCreateClientId, setClientCookie } from '@/lib/http';

/**
 * `GET /api/analyses/[id]`：查單一筆分析的進度與結果。
 *
 * 一律用 `getForClient` 過濾，查到別人的 id 一律回 404（不是 403），
 * 避免讓人靠回應差異猜出某個 id 是否存在。
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { clientId, isNew } = getOrCreateClientId(request);

  const detail = await getForClient(id, clientId);
  if (!detail) {
    return errorResponse('not_found', '找不到指定的分析紀錄。', 404);
  }

  const { row, files } = detail;

  const [checklistDoc, regulationDoc] = await Promise.all([
    row.checklistVersionId ? getVersion(row.checklistVersionId) : Promise.resolve(null),
    row.regulationVersionId ? getVersion(row.regulationVersionId) : Promise.resolve(null),
  ]);

  const fileSummaries: AnalysisFileSummary[] = files.map((file) => ({
    id: file.id,
    name: file.originalName,
    size: file.size,
    category: categoryFromMime(file.mime),
    extractMethod: file.extractMethod ?? 'text',
    pageCount: file.pageCount ?? 1,
  }));

  const isFinished = row.status === 'done' || row.status === 'failed';

  const body: AnalysisDetailResponse = {
    id: row.id,
    status: row.status,
    mode: row.mode,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    files: fileSummaries,
    progress: { current: isFinished ? files.length : 0, total: files.length },
    result: row.status === 'done' ? row.resultJson : null,
    error: row.status === 'failed' ? (row.errorMessage ?? '分析失敗，原因不明。') : null,
    checklistVersion: checklistDoc?.version ?? null,
    regulationVersion: regulationDoc?.version ?? null,
  };

  const response = NextResponse.json(body, { status: 200 });
  if (isNew) {
    setClientCookie(response, clientId);
  }
  return response;
}
