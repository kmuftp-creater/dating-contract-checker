import type { Metadata, Viewport } from 'next';

import { ThemeScript } from '@/components/theme-script';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '交友合約健檢',
    template: '%s ｜ 交友合約健檢',
  },
  description:
    '依內政部「交友媒合服務定型化契約應記載及不得記載事項」與查核表，逐條檢查交友媒合服務契約是否合規。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
