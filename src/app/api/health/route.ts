import { NextResponse } from 'next/server';

import { env } from '@/lib/env';

/**
 * 健康檢查。容器的 HEALTHCHECK 與 nginx 都會打這支。
 * 只回報服務是否活著，不吐任何設定值或版本細節以外的資訊。
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    ok: true,
    edition: env.edition,
    time: new Date().toISOString(),
  });
}
