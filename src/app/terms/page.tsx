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
    title: '服務條款',
    description: '交友合約健檢的服務條款：使用範圍、免責聲明，以及帳號、上傳內容與終止使用的相關規定。',
    path: '/terms',
  });
}

export default function TermsPage() {
  return <LegalDocumentPage kind="terms" />;
}
