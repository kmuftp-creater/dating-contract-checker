'use client';

import { Ban, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { BlocklistType } from '@/lib/admin/moderation';
import type { schema } from '@/db';

import {
  addBlocklistAction,
  removeBlocklistAction,
  resetOffTopicAction,
  unsuspendAction,
} from '../actions/moderation';

/**
 * 「IP 與封鎖」頁的互動主體。
 *
 * 封鎖與移除都會立即影響使用者存取，依規格書要求一律先跳出
 * `window.confirm` 二次確認才呼叫伺服器動作，寫法與
 * `dashboard-ip-ranking.tsx` 的一鍵封鎖一致。
 *
 * 這三個伺服器動作（`addBlocklistAction`、`removeBlocklistAction`、
 * `unsuspendAction`）都回傳 `void`，不像 `settings.ts` 的動作會回傳
 * 更新後的資料，所以這裡不維護一份獨立於 props 的本地清單狀態，而是
 * 直接渲染 `suspended`／`blocklist` 這兩個 props，操作成功後呼叫
 * `router.refresh()` 讓上層伺服器元件重新查詢，新的 props 自然帶出
 * 最新清單，不需要在用戶端手動拼湊資料庫正規化後的值。
 */

export interface SuspendedIpView {
  id: string;
  ip: string;
  reason: string | null;
  suspendedUntil: string | null;
  suspendCount24h: number;
  updatedAt: string;
}

export interface BlocklistEntryView {
  id: string;
  type: BlocklistType;
  value: string;
  reason: string | null;
  createdAt: string;
}

export interface OffTopicIpView {
  id: string;
  ip: string;
  /** 累計上傳非交友媒合服務契約的次數。 */
  offTopicCount: number;
  status: (typeof schema.ipStatus.$inferSelect)['status'];
  updatedAt: string;
}

const IP_STATUS_LABEL: Record<OffTopicIpView['status'], string> = {
  normal: '正常',
  suspended: '暫停中',
  blocked: '已封鎖',
};

const TYPE_LABEL: Record<BlocklistType, string> = {
  ip: 'IP',
  cidr: 'CIDR 網段',
  email: '信箱',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '－';
  return new Date(iso).toLocaleString('zh-Hant-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

export function IpsPanel({
  initialSuspended: suspended,
  initialBlocklist: blocklist,
  initialOffTopic: offTopic,
}: {
  initialSuspended: SuspendedIpView[];
  initialBlocklist: BlocklistEntryView[];
  initialOffTopic: OffTopicIpView[];
}) {
  const router = useRouter();

  const [suspendError, setSuspendError] = useState<string | null>(null);
  const [pendingUnsuspendId, setPendingUnsuspendId] = useState<string | null>(null);
  const [isUnsuspendPending, startUnsuspendTransition] = useTransition();

  const [offTopicError, setOffTopicError] = useState<string | null>(null);
  const [pendingResetId, setPendingResetId] = useState<string | null>(null);
  const [isResetPending, startResetTransition] = useTransition();

  const [blocklistError, setBlocklistError] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [isRemovePending, startRemoveTransition] = useTransition();

  const [addType, setAddType] = useState<BlocklistType>('ip');
  const [addValue, setAddValue] = useState('');
  const [addReason, setAddReason] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [isAddPending, startAddTransition] = useTransition();

  function handleUnsuspend(row: SuspendedIpView): void {
    if (!window.confirm(`確定要提前解除 IP「${row.ip}」的暫停狀態嗎？`)) {
      return;
    }
    setSuspendError(null);
    setPendingUnsuspendId(row.id);
    startUnsuspendTransition(async () => {
      try {
        await unsuspendAction(row.ip);
        router.refresh();
      } catch (error) {
        setSuspendError(error instanceof Error ? error.message : '解除暫停失敗。');
      } finally {
        setPendingUnsuspendId(null);
      }
    });
  }

  function handleResetOffTopic(row: OffTopicIpView): void {
    if (
      !window.confirm(
        `確定要把 IP「${row.ip}」的非目標文件累計次數歸零嗎？這不會連帶解除既有的暫停或封鎖狀態。`,
      )
    ) {
      return;
    }
    setOffTopicError(null);
    setPendingResetId(row.id);
    startResetTransition(async () => {
      try {
        await resetOffTopicAction(row.ip);
        router.refresh();
      } catch (error) {
        setOffTopicError(error instanceof Error ? error.message : '歸零失敗。');
      } finally {
        setPendingResetId(null);
      }
    });
  }

  function handleRemove(row: BlocklistEntryView): void {
    if (
      !window.confirm(
        `確定要移除這筆封鎖（${TYPE_LABEL[row.type]}：${row.value}）嗎？移除後該來源會立即恢復存取。`,
      )
    ) {
      return;
    }
    setBlocklistError(null);
    setPendingRemoveId(row.id);
    startRemoveTransition(async () => {
      try {
        await removeBlocklistAction(row.id);
        router.refresh();
      } catch (error) {
        setBlocklistError(error instanceof Error ? error.message : '移除封鎖失敗。');
      } finally {
        setPendingRemoveId(null);
      }
    });
  }

  function handleAdd(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (addValue.trim() === '') {
      setAddError('請輸入要封鎖的內容。');
      return;
    }
    const trimmedValue = addValue.trim();
    if (
      !window.confirm(
        `確定要新增封鎖（${TYPE_LABEL[addType]}：${trimmedValue}）嗎？這會立即擋下該來源的所有前台請求。`,
      )
    ) {
      return;
    }
    setAddError(null);
    setAddMessage(null);
    startAddTransition(async () => {
      try {
        await addBlocklistAction(addType, trimmedValue, addReason.trim());
        setAddValue('');
        setAddReason('');
        setAddMessage(`已新增封鎖：${TYPE_LABEL[addType]}「${trimmedValue}」。`);
        router.refresh();
      } catch (error) {
        setAddError(error instanceof Error ? error.message : '新增封鎖失敗。');
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* 目前暫停中的 IP */}
      <div className="card p-4">
        <p className="mb-3 text-sm font-medium text-ink">目前暫停中的 IP</p>
        {suspendError && <p className="mb-3 text-sm text-danger">{suspendError}</p>}
        {suspended.length === 0 ? (
          <p className="text-sm text-ink-muted">目前沒有暫停中的 IP。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-ink-muted">
                  <th className="px-3 py-2 font-semibold">IP</th>
                  <th className="px-3 py-2 font-semibold">原因</th>
                  <th className="px-3 py-2 font-semibold">可於幾時恢復</th>
                  <th className="px-3 py-2 font-semibold">24 小時內暫停次數</th>
                  <th className="px-3 py-2 font-semibold">更新時間</th>
                  <th className="px-3 py-2 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {suspended.map((row) => (
                  <tr key={row.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-ink">{row.ip}</td>
                    <td className="px-3 py-2 text-ink-muted">{row.reason ?? '－'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                      {formatDateTime(row.suspendedUntil)}
                    </td>
                    <td className="px-3 py-2 text-ink">{row.suspendCount24h}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatDateTime(row.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleUnsuspend(row)}
                        disabled={isUnsuspendPending && pendingUnsuspendId === row.id}
                        className="rounded-(--radius-control) border border-hairline px-2.5 py-1 text-xs text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isUnsuspendPending && pendingUnsuspendId === row.id ? '處理中…' : '提前解除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 非交友媒合服務契約累計次數 */}
      <div className="card p-4">
        <p className="mb-3 text-sm font-medium text-ink">非目標文件累計次數</p>
        <p className="mb-3 text-xs text-ink-muted">
          偵測到上傳內容不是交友媒合服務契約時累加；達門檻會自動暫停或封鎖（見後台「濫用規則」設定）。
          歸零只重設次數，不會連帶解除既有的暫停或封鎖狀態。
        </p>
        {offTopicError && <p className="mb-3 text-sm text-danger">{offTopicError}</p>}
        {offTopic.length === 0 ? (
          <p className="text-sm text-ink-muted">目前沒有累計非目標文件次數的 IP。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-ink-muted">
                  <th className="px-3 py-2 font-semibold">IP</th>
                  <th className="px-3 py-2 font-semibold">累計次數</th>
                  <th className="px-3 py-2 font-semibold">目前狀態</th>
                  <th className="px-3 py-2 font-semibold">更新時間</th>
                  <th className="px-3 py-2 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {offTopic.map((row) => (
                  <tr key={row.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-ink">{row.ip}</td>
                    <td className="px-3 py-2 text-ink">{row.offTopicCount}</td>
                    <td className="px-3 py-2 text-ink-muted">{IP_STATUS_LABEL[row.status]}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatDateTime(row.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleResetOffTopic(row)}
                        disabled={isResetPending && pendingResetId === row.id}
                        className="rounded-(--radius-control) border border-hairline px-2.5 py-1 text-xs text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isResetPending && pendingResetId === row.id ? '處理中…' : '歸零'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 封鎖清單 */}
      <div className="card p-4">
        <p className="mb-3 text-sm font-medium text-ink">封鎖清單</p>
        {blocklistError && <p className="mb-3 text-sm text-danger">{blocklistError}</p>}
        {blocklist.length === 0 ? (
          <p className="text-sm text-ink-muted">封鎖清單目前是空的。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-ink-muted">
                  <th className="px-3 py-2 font-semibold">類型</th>
                  <th className="px-3 py-2 font-semibold">內容</th>
                  <th className="px-3 py-2 font-semibold">原因</th>
                  <th className="px-3 py-2 font-semibold">建立時間</th>
                  <th className="px-3 py-2 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {blocklist.map((row) => (
                  <tr key={row.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-ink">{TYPE_LABEL[row.type]}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink">{row.value}</td>
                    <td className="px-3 py-2 text-ink-muted">{row.reason ?? '－'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{formatDateTime(row.createdAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleRemove(row)}
                        disabled={isRemovePending && pendingRemoveId === row.id}
                        className="inline-flex items-center gap-1.5 rounded-(--radius-control) border border-danger/50 px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        {isRemovePending && pendingRemoveId === row.id ? '移除中…' : '移除'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 手動新增封鎖 */}
      <div className="card space-y-4 p-4">
        <p className="text-sm font-medium text-ink">手動新增封鎖</p>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="add-type" className="mb-1 block text-xs text-ink-muted">
              類型
            </label>
            <select
              id="add-type"
              value={addType}
              onChange={(event) => setAddType(event.target.value as BlocklistType)}
              className="rounded-(--radius-control) border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink"
            >
              <option value="ip">IP</option>
              <option value="cidr">CIDR 網段</option>
              <option value="email">信箱</option>
            </select>
          </div>
          <div>
            <label htmlFor="add-value" className="mb-1 block text-xs text-ink-muted">
              內容
            </label>
            <input
              id="add-value"
              type="text"
              value={addValue}
              onChange={(event) => setAddValue(event.target.value)}
              placeholder={
                addType === 'ip' ? '例如 203.0.113.5' : addType === 'cidr' ? '例如 203.0.113.0/24' : '例如 a@b.com'
              }
              className="w-56 rounded-(--radius-control) border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <div>
            <label htmlFor="add-reason" className="mb-1 block text-xs text-ink-muted">
              原因（選填）
            </label>
            <input
              id="add-reason"
              type="text"
              value={addReason}
              onChange={(event) => setAddReason(event.target.value)}
              className="w-56 rounded-(--radius-control) border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink"
            />
          </div>
          <button
            type="submit"
            disabled={isAddPending}
            className="inline-flex items-center gap-1.5 rounded-(--radius-control) bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Ban className="size-4" aria-hidden />
            {isAddPending ? '新增中…' : '新增封鎖'}
          </button>
        </form>
        {addMessage && <p className="text-sm text-ok">{addMessage}</p>}
        {addError && <p className="text-sm text-danger">{addError}</p>}
      </div>
    </div>
  );
}
