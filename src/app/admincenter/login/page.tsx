import { redirect } from 'next/navigation';

import { auth, signIn } from '@/auth';
import { SiteFooter } from '@/components/site-footer';

export const metadata = { title: '管理員登入' };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.email) {
    redirect('/admincenter');
  }

  const { error } = await searchParams;

  async function signInWithGoogle() {
    'use server';
    await signIn('google', { redirectTo: '/admincenter' });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="card w-full max-w-sm p-8">
          <h1 className="text-xl font-semibold">管理員登入</h1>
          <p className="mt-2 text-sm text-ink-muted">
            僅限白名單信箱。其他帳號即使通過 Google 驗證也無法進入。
          </p>

          {error ? (
            <p className="mt-4 rounded-(--radius-control) bg-danger/10 px-3 py-2 text-sm text-danger">
              登入失敗。這個帳號不在白名單內，或授權過程被中止。
            </p>
          ) : null}

          <form action={signInWithGoogle} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-(--radius-control) bg-brand px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-hover"
            >
              以 Google 帳號登入
            </button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
