import Link from 'next/link';

import { requireAdmin, signOut } from '@/auth';
import { SiteFooter } from '@/components/site-footer';
import { ThemeToggle } from '@/components/theme-toggle';
import { EXTRA_ADMIN_NAV } from '@/lib/email/hooks';

export const metadata = {
  title: { default: '後台', template: '%s ｜ 後台' },
  // 後台一律不給搜尋引擎索引，登入頁也在裡面，不該被收錄。
  robots: { index: false, follow: false },
};

/** 後台導覽的核心項目。這份部署額外掛了什麼，由 `EXTRA_ADMIN_NAV` 提供。 */
const NAV = [
  { href: '/admincenter', label: '總覽' },
  { href: '/admincenter/analyses', label: '使用紀錄' },
  { href: '/admincenter/ips', label: 'IP 與封鎖' },
  { href: '/admincenter/reports', label: '問題回報' },
  { href: '/admincenter/documents', label: '法規文件' },
  { href: '/admincenter/settings/ai', label: 'AI 設定' },
] as const;

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAdmin();

  // 登入頁本身也在 /admin 底下，未登入時由各頁自行導向，
  // 這裡只負責已登入狀態的外框。
  if (!user) {
    return <>{children}</>;
  }

  async function doSignOut() {
    'use server';
    await signOut({ redirectTo: '/admincenter/login' });
  }

  const items = [...NAV, ...EXTRA_ADMIN_NAV];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="font-semibold">交友合約健檢　後台</span>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-ink-muted transition-colors hover:text-brand"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">
              {user.email}
            </span>
            <ThemeToggle />
            <form action={doSignOut}>
              <button
                type="submit"
                className="rounded-(--radius-control) border border-hairline px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
              >
                登出
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>

      <SiteFooter />
    </div>
  );
}
