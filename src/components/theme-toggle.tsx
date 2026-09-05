'use client';

import { Moon, Sun } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * 亮暗模式切換。
 *
 * 依 02-DESIGN 規範，按鈕顯示的是「目前狀態的對立面」：
 * 亮色模式下顯示月亮與「暗色」，引導使用者切換過去。
 *
 * 目前主題的真實來源是根元素上的 dark 類別（由 ThemeScript 在繪製前設定），
 * 也就是 React 之外的狀態，所以用 useSyncExternalStore 訂閱它，
 * 而不是在 effect 裡設定狀態造成連鎖重繪。
 */

/** 訂閱根元素 class 的變化。 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** 伺服器端渲染時無從得知使用者的主題，一律當亮色，補水後會自動校正。 */
function getServerSnapshot(): boolean {
  return false;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // 無法寫入儲存空間時只影響下次載入，不影響本次切換。
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-1.5 rounded-(--radius-control) border border-hairline px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
      aria-label={dark ? '切換為亮色模式' : '切換為暗色模式'}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span>{dark ? '亮色' : '暗色'}</span>
    </button>
  );
}
