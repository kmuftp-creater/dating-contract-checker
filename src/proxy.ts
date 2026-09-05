import { NextResponse, type NextRequest } from 'next/server';

/**
 * 網域分流。
 *
 * 後台預設與前台共用同一個網址，放在 `/admincenter` 底下，靠登入保護
 * （2026-09-05 User 決定）。保護後台的本來就是登入，不是網址。
 *
 * 若把 `ADMIN_HOST` 設成與 `PUBLIC_HOST` 不同的值，就會切換成「後台獨立
 * 網域」模式：前台網域連 `/admincenter` 都直接 404，等於在登入之外多一道
 * 與身分驗證無關的防線。代價是要多一筆 DNS、多一張憑證。兩種都支援，
 * 由設定決定，程式不預設立場。
 *
 * 注意：這裡執行在 Edge 執行環境，不能匯入 `src/lib/env.ts`
 * （那個檔案標了 server-only 且會用到 Node 專屬功能），所以直接讀 process.env。
 */

const PUBLIC_HOST = (process.env.PUBLIC_HOST ?? 'localhost:3400').toLowerCase();
const ADMIN_HOST_RAW = (process.env.ADMIN_HOST ?? '').toLowerCase().trim();

/** 後台是否有自己的網域。留空或與前台相同時視為共用同一個網址。 */
const SEPARATE_ADMIN_HOST = ADMIN_HOST_RAW !== '' && ADMIN_HOST_RAW !== PUBLIC_HOST;

/** 後台路徑前綴。 */
const ADMIN_PREFIX = '/admincenter';

/** 兩種模式都要放行的路徑前綴：靜態資源與登入流程。 */
const SHARED_PREFIXES = ['/_next', '/favicon.ico', '/api/auth', '/robots.txt'];

function isShared(pathname: string): boolean {
  return SHARED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isShared(pathname)) {
    return NextResponse.next();
  }

  // 共用同一個網址：所有路徑都放行，後台由 requireAdmin() 守門。
  if (!SEPARATE_ADMIN_HOST) {
    return NextResponse.next();
  }

  const host = (request.headers.get('host') ?? '').toLowerCase();

  if (host === ADMIN_HOST_RAW) {
    // 後台網域：只開放後台路徑。
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = ADMIN_PREFIX;
      return NextResponse.redirect(url);
    }
    if (!isAdminPath(pathname)) {
      return new NextResponse('Not Found', { status: 404 });
    }
    return NextResponse.next();
  }

  // 前台網域（含未知主機名稱）：擋掉後台路徑。
  if (isAdminPath(pathname)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  // 排除靜態檔案，其餘全部經過代理層。
  matcher: ['/((?!_next/static|_next/image).*)'],
};
