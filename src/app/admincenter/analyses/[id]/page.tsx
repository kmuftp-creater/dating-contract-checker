import Link from 'next/link';
import { redirect } from 'next/navigation';

import { StatusBadge } from '@/components/result/status-badge';
import { SummaryBar } from '@/components/result/summary-bar';
import { getAnalysisForAdmin } from '@/lib/admin/records';
import { estimateCostUsd } from '@/lib/admin/stats';
import { requireAdmin } from '@/auth';
import { getVersion } from '@/lib/documents';
import type { AnalysisMode, AnalysisStatus, ExtractMethod } from '@/lib/types';

/**
 * 單筆分析的後台檢視頁。
 *
 * 對應設計文件第三章第 4 節「單筆檢視」。找不到這筆分析時顯示「查無此筆
 * 分析」而不是讓 `notFound()` 產生 404，理由是這通常是管理員手動輸入
 * 網址或資料已被保留期政策清除，屬於預期內的正常情形，不是伺服器錯誤。
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { title: '分析詳情' };
}

const MODE_LABEL: Record<AnalysisMode, string> = {
  merged: '合併為一份合約',
  separate: '各檔獨立分析',
};

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: '排隊中',
  running: '處理中',
  done: '完成',
  failed: '失敗',
};

const EXTRACT_METHOD_LABEL: Record<ExtractMethod, string> = {
  text: '文字抽取',
  ocr: '影像辨識',
};

function formatDateTime(date: Date | null): string {
  if (!date) return '－';
  return date.toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function formatUsd(value: number): string {
  return `US$ ${value.toFixed(6)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const { id } = await params;
  const detail = await getAnalysisForAdmin(id);

  if (!detail) {
    return (
      <div className="space-y-6">
        <Link href="/admincenter/analyses" className="text-sm text-brand hover:underline">
          ← 返回使用紀錄
        </Link>
        <div className="card p-6">
          <p className="text-danger">查無此筆分析：可能已被刪除、超過保留期限，或網址有誤。</p>
        </div>
      </div>
    );
  }

  const { row, files } = detail;
  const costEstimateUsd = estimateCostUsd(row.model, row.inputTokens, row.outputTokens);

  const [checklistVersion, regulationVersion] = await Promise.all([
    row.checklistVersionId ? getVersion(row.checklistVersionId) : Promise.resolve(null),
    row.regulationVersionId ? getVersion(row.regulationVersionId) : Promise.resolve(null),
  ]);

  const items = row.resultJson?.items ?? [];

  return (
    <div className="space-y-6">
      <Link href="/admincenter/analyses" className="text-sm text-brand hover:underline">
        ← 返回使用紀錄
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">分析詳情</h1>
        <p className="mt-1 font-mono text-sm text-ink-muted">{row.id}</p>
      </div>

      <div className="card grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Field label="建立時間" value={formatDateTime(row.createdAt)} />
        <Field label="完成時間" value={formatDateTime(row.finishedAt)} />
        <Field label="IP" value={row.ip} />
        <Field label="瀏覽器識別碼" value={row.clientId} mono />
        <Field label="模式" value={MODE_LABEL[row.mode]} />
        <Field label="狀態" value={STATUS_LABEL[row.status]} />
        <Field label="模型" value={row.model ?? '－'} />
        <Field
          label="輸入 / 輸出 token"
          value={`${row.inputTokens ?? '－'} / ${row.outputTokens ?? '－'}`}
        />
        <Field label="估算費用" value={formatUsd(costEstimateUsd)} />
        <Field label="查核表版本" value={checklistVersion ? `第 ${checklistVersion.version} 版` : '－'} />
        <Field label="公告全文版本" value={regulationVersion ? `第 ${regulationVersion.version} 版` : '－'} />
      </div>

      {row.status === 'failed' && (
        <div className="card space-y-2 border border-danger/50 p-4">
          <p className="font-medium text-danger">失敗訊息</p>
          <p className="text-sm text-ink">{row.errorMessage ?? '分析失敗，原因不明。'}</p>
        </div>
      )}

      {(row.status === 'queued' || row.status === 'running') && (
        <div className="card p-4 text-sm text-ink-muted">
          這筆分析目前仍在{STATUS_LABEL[row.status]}，尚無結果可顯示，請稍後重新整理本頁。
        </div>
      )}

      <div className="card p-4">
        <p className="mb-3 text-sm font-medium text-ink">檔案清單（共 {files.length} 個）</p>
        {files.length === 0 ? (
          <p className="text-sm text-ink-muted">沒有附帶檔案。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-ink-muted">
                  <th className="px-3 py-2 font-semibold">檔名</th>
                  <th className="px-3 py-2 font-semibold">類型</th>
                  <th className="px-3 py-2 font-semibold">大小</th>
                  <th className="px-3 py-2 font-semibold">抽取方式</th>
                  <th className="px-3 py-2 font-semibold">頁數</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 text-ink">{file.originalName}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{file.mime}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatSize(file.size)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                      {file.extractMethod ? EXTRACT_METHOD_LABEL[file.extractMethod] : '－'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{file.pageCount ?? '－'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {row.status === 'done' && row.resultJson && (
        <>
          <SummaryBar summary={row.resultJson.summary} />

          {row.resultJson.notes && (
            <div className="card p-4 text-sm text-warn">備註：{row.resultJson.notes}</div>
          )}

          <div className="card overflow-x-auto p-4">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-ink-muted">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">查核項目</th>
                  <th className="px-3 py-2 font-semibold">合約現況</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">判定</th>
                  <th className="px-3 py-2 font-semibold">改善方式</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-hairline align-top last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-ink">
                      <span className="text-ink-muted">{item.id}．</span>
                      {item.title}
                    </td>
                    <td className="px-3 py-2 text-ink">{item.evidence || '－'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {item.status === 'pass' || item.status === 'na' ? '' : item.fix}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`mt-0.5 text-ink ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
