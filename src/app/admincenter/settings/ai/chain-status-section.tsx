import { AlertTriangle, CircleCheck, CircleOff, Info, ShieldAlert } from 'lucide-react';

import type { ChainLayerStatusKind, ChainStatusView } from '@/lib/ai/chain-status';

/**
 * 「備援鏈狀態」區塊：規格書 E 段。純呈現用的伺服器元件，資料由
 * `page.tsx` 呼叫 `getChainStatusAction` 取得後傳入，不需要用戶端互動，
 * 因此不必是 client component。
 */

const TRANSPORT_LABEL: Record<'direct' | 'gateway', string> = {
  direct: '直連上游',
  gateway: '經閘道',
};

const STATUS_STYLE: Record<ChainLayerStatusKind, { label: string; className: string }> = {
  ready: { label: '就緒', className: 'border-ok/50 bg-ok/10 text-ok' },
  circuit_open: { label: '熔斷中', className: 'border-warn/50 bg-warn/10 text-warn' },
  disabled: { label: '已停用', className: 'border-hairline bg-canvas text-ink-muted' },
};

function StatusBadge({ status }: { status: ChainLayerStatusKind }) {
  const style = STATUS_STYLE[status];
  const Icon = status === 'ready' ? CircleCheck : status === 'circuit_open' ? ShieldAlert : CircleOff;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-(--radius-control) border px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {style.label}
    </span>
  );
}

function formatLastEvent(lastEvent: ChainStatusView['layers'][number]['lastEvent']): string {
  if (!lastEvent) {
    return '尚無紀錄';
  }
  const time = new Date(lastEvent.at).toLocaleString('zh-TW', { hour12: false });
  return lastEvent.ok ? `${time}・成功` : `${time}・失敗（${lastEvent.category ?? '未分類'}）`;
}

export function ChainStatusSection({ status }: { status: ChainStatusView }) {
  return (
    <div className="card space-y-4 p-4">
      <div>
        <p className="text-sm font-medium text-ink">備援鏈狀態</p>
        <p className="mt-1 text-sm text-ink-muted">
          每次分析依下表由上而下嘗試，任一層成功即回傳結果；跳層與熔斷規則見表格下方說明。
        </p>
      </div>

      {status.lastEnabledLayerSucceededRecently ? (
        <div className="flex items-start gap-2 rounded-(--radius-control) border border-warn/50 bg-warn/10 p-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p>
            要處理的事：最後一層「{status.lastEnabledLayerLabel}」在近 30 天內有成功紀錄，
            代表它前面的每一層都至少失敗過一次。該修的是前面那幾層，不是這一層——這一層本來
            就只是備援，一直被用到表示前面不穩定。
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-(--radius-control) border border-ok/50 bg-ok/10 p-3 text-sm text-ink">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
          <p>目前沒有需要處理的事。</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-(--radius-control) border border-hairline">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead className="bg-canvas">
            <tr className="border-b border-hairline">
              <th className="w-[22%] px-3 py-2 text-left align-top font-semibold break-words text-ink">層</th>
              <th className="w-[10%] px-3 py-2 text-left align-top font-semibold break-words text-ink">送法</th>
              <th className="w-[13%] px-3 py-2 text-left align-top font-semibold break-words text-ink">上游</th>
              <th className="w-[15%] px-3 py-2 text-left align-top font-semibold break-words text-ink">模型</th>
              <th className="w-[10%] px-3 py-2 text-left align-top font-semibold break-words text-ink">目前狀態</th>
              <th className="w-[8%] px-3 py-2 text-left align-top font-semibold break-words text-ink">近 30 天完成</th>
              <th className="w-[8%] px-3 py-2 text-left align-top font-semibold break-words text-ink">近 30 天失敗</th>
              <th className="w-[14%] px-3 py-2 text-left align-top font-semibold break-words text-ink">最後事件</th>
            </tr>
          </thead>
          <tbody>
            {status.layers.map((layer) => (
              <tr key={layer.id} className="border-b border-hairline last:border-0 align-top">
                <td className="px-3 py-2 align-top break-words text-ink">
                  <p className="font-medium">{layer.label}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">{layer.id}</p>
                  <p className="mt-1 text-xs text-ink-muted">{layer.purpose}</p>
                </td>
                <td className="px-3 py-2 align-top break-words text-ink">{TRANSPORT_LABEL[layer.transport]}</td>
                <td className="px-3 py-2 align-top break-words text-ink">{layer.upstream}</td>
                <td className="px-3 py-2 align-top break-words font-mono text-xs text-ink">{layer.model}</td>
                <td className="px-3 py-2 align-top">
                  <StatusBadge status={layer.status} />
                </td>
                <td className="px-3 py-2 align-top break-words text-ink">{layer.completed30d}</td>
                <td className="px-3 py-2 align-top break-words text-ink">{layer.failed30d}</td>
                <td className="px-3 py-2 align-top break-words text-xs text-ink-muted">
                  {formatLastEvent(layer.lastEvent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-(--radius-control) border border-info/40 bg-info/10 p-3 text-sm text-ink">
        <div className="mb-2 flex items-center gap-2">
          <Info className="size-4 shrink-0 text-info" aria-hidden />
          <p className="font-medium">跳層規則：某一層失敗時，系統怎麼決定要不要跳過後面的層</p>
        </div>
        <ul className="space-y-1.5 text-xs text-ink-muted">
          {status.errorCategoryRules.map((rule) => (
            <li key={rule.category}>
              <span className="font-medium text-ink">{rule.label}</span>
              （判定依據：{rule.judgedBy}）：{rule.behavior}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-ink-muted">
        重要決定：這條鏈到最後一層為止，不會有更後面的「示範模式」。全部層都失敗時，系統一律
        明確回報分析失敗、不偽造合規報告——本工具是法規檢核工具，一份捏造的合規報告比沒有報告
        危險得多，因此不像某些對話產品在全部上游失敗時退回內建示範內容。
      </p>
    </div>
  );
}
