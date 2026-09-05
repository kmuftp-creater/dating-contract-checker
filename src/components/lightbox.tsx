'use client';

import { X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef } from 'react';

/**
 * 圖片放大檢視（燈箱）。
 *
 * 半透明遮罩置中顯示原圖，點遮罩、按 Esc 或按右上角的關閉按鈕都能關閉。
 * `src` 為 `null` 時不渲染任何東西，呼叫端只需要用一個狀態控制開關。
 *
 * 圖片走 `unoptimized`：來源是同網域的 API 路由（回報截圖），內容已經
 * 是轉檔過的 WebP，不需要再經過 Next 的圖片最佳化管線。
 */

export interface LightboxProps {
  /** 要放大顯示的圖片網址；`null` 代表關閉。 */
  src: string | null;
  /** 圖片替代文字，同時作為對話框的無障礙標籤。 */
  alt: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!src) {
      return;
    }

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [src, onClose]);

  if (!src) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-8"
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="關閉放大檢視"
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
      >
        <X className="size-5" aria-hidden />
      </button>

      <div
        onClick={(event) => event.stopPropagation()}
        className="relative h-[80vh] w-full max-w-3xl"
      >
        <Image src={src} alt={alt} fill unoptimized className="object-contain" />
      </div>
    </div>
  );
}
