import { LegalDocumentPage } from '@/components/legal-page';

export const metadata = { title: '服務條款' };

/** 內容來自資料庫，管理員在後台更新後應立即反映，因此不預先產生。 */
export const dynamic = 'force-dynamic';

export default function TermsPage() {
  return <LegalDocumentPage kind="terms" />;
}
