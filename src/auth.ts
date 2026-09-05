import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

import { env } from '@/lib/env';

/**
 * 後台登入。
 *
 * 用 Google 帳號登入，且信箱必須在 ADMIN_EMAILS 白名單內。
 * 工作階段用 JWT，不寫資料庫，所以登入功能不依賴資料庫是否已完成遷移。
 */

function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return env.adminEmails.includes(email.toLowerCase());
}

/**
 * 告訴 Auth.js 這個站對外的網址是什麼。
 *
 * 不設定的話，它會從執行環境推測，而容器裡的 HOSTNAME 是 0.0.0.0、PORT 是
 * 3400，於是對外宣告的回呼網址變成 `https://0.0.0.0:3400/api/auth/callback/google`
 * ——Google 當然不會接受，登入直接失敗。
 *
 * 這裡從 PUBLIC_HOST 推導而不是要求部署者再設一個環境變數：兩者本來就該一致，
 * 讓它們可以各設各的只會製造出「改了一個忘了另一個」的故障。
 * 仍允許用 AUTH_URL 覆寫，供反向代理架構特殊的情況使用。
 */
if (!process.env.AUTH_URL) {
  const host = env.publicHost;
  const scheme = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  process.env.AUTH_URL = `${scheme}://${host}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: env.authSecret,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/admincenter/login',
    error: '/admincenter/login',
  },
  providers: [
    Google({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
    }),
  ],
  callbacks: {
    /** 白名單之外的帳號一律擋在門外，即使 Google 驗證通過。 */
    signIn({ profile }) {
      return isAllowed(profile?.email);
    },
  },
});

/**
 * 後台頁面共用的守門函式：未登入或不在白名單時回傳 null。
 *
 * 這裡每次都重新比對白名單，不只信任已簽發的權杖。
 * 把某個信箱從 ADMIN_EMAILS 移除後，對方現有的登入狀態會立刻失效，
 * 不必等權杖過期。
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email || !isAllowed(session.user.email)) {
    return null;
  }
  return session.user;
}
