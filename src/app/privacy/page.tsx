import type { Metadata } from 'next';

import { LegalDocumentPage } from '@/components/legal-page';
import { buildPageMetadata } from '@/lib/site';

/**
 * 內容來自資料庫，管理員在後台更新後應立即反映，因此不預先產生；
 * 這同時也保證 `generateMetadata()` 裡用到的網址一定在執行期才求值。
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: '隱私權政策',
    description: '交友合約健檢的隱私權政策：上傳的合約內容與個人資料會被如何蒐集、使用、保留與刪除。',
    path: '/privacy',
  });
}

export default function PrivacyPage() {
  return <LegalDocumentPage kind="privacy" />;
}
