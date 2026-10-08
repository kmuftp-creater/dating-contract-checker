import Link from 'next/link';

/**
 * 頁尾。
 *
 * 三個作用：
 * 1. 隱私權政策與服務條款的連結必須在每一頁都看得到（Google 的 OAuth
 *    同意畫面要求，使用者也應該隨時找得到）。
 * 2. 免責聲明放在這裡而不是只放在使用說明裡。使用者可能直接從搜尋結果
 *    落到報告頁，沒看過首頁，卻正要拿那份報告去做決定——那個時刻最需要
 *    知道「這不是官方查核結果」。
 * 3. 著作標示。
 *
 * 標示的名稱與網址由環境變數提供，原始碼裡不寫死：同一套程式可以被不同
 * 單位各自部署，頁尾該掛誰的名字由該單位自己決定，沒設定就只顯示服務名稱。
 * 授權條款記載於 `LICENSE`。
 *
 * 這裡刻意**不**讀 `@/lib/env`：這個元件會被 `src/app/page.tsx` 等客戶端
 * 元件引用，而 `@/lib/env` 標了 `server-only`，引進來會讓整個建置失敗。
 * 改用建置期就會內嵌的 `NEXT_PUBLIC_` 變數。
 */

/** 著作標示。兩個變數都有值才顯示連結，沒設定就只顯示服務名稱。 */
const CREDIT_LABEL = process.env.NEXT_PUBLIC_SITE_CREDIT_LABEL ?? '';
const CREDIT_URL = process.env.NEXT_PUBLIC_SITE_CREDIT_URL ?? '';
const SITE_CREDIT = CREDIT_LABEL && CREDIT_URL ? { label: CREDIT_LABEL, url: CREDIT_URL } : null;

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-hairline">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-sm leading-relaxed text-ink-muted">
          本服務<strong className="text-ink">免費提供</strong>，不需註冊或登入。
          檢核結果由 AI 產生，屬於<strong className="text-ink">自行檢查用的參考</strong>，
          不構成法律意見，也不等於主管機關的查核結果。
          一切以內政部與地方主管機關公告的內容及其認定為準；
          報告顯示「符合」不代表該條款一定合規，顯示「不符合」也可能是誤判，
          請務必逐條複核。
        </p>

        <div className="mt-4 flex flex-col items-start gap-3 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/privacy" className="transition-colors hover:text-brand">
              隱私權政策
            </Link>
            <Link href="/terms" className="transition-colors hover:text-brand">
              服務條款
            </Link>
            <Link href="/regulations" className="transition-colors hover:text-brand">
              法規文件
            </Link>
            <Link href="/faq" className="transition-colors hover:text-brand">
              常見問題
            </Link>
            <Link href="/report" className="transition-colors hover:text-brand">
              問題回報
            </Link>
          </nav>

          <p>
            ©2026
            {SITE_CREDIT ? (
              <>
                {' '}
                <a
                  href={SITE_CREDIT.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  {SITE_CREDIT.label}
                </a>
              </>
            ) : (
              ' 交友合約健檢'
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}
