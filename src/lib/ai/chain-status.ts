import 'server-only';

import type { AiSettings } from '@/lib/settings';

import { buildChainLayers, isCircuitOpen, CHAIN_ERROR_CATEGORY_INFO, type ChainErrorCategory } from './chain';
import { getChainLayerStats } from './chain-events';

/**
 * 組出後台「備援鏈狀態」表格要顯示的資料：鏈的靜態定義（見 `chain.ts`）
 * 疊上目前的熔斷狀態與近 30 天統計（見 `chain-events.ts`）。
 *
 * 獨立成這個檔案（而不是直接寫在 server action 或頁面元件裡）的理由：
 * 讓 `page.tsx` 能像讀其他設定一樣直接呼叫一般的資料層函式，不必透過
 * `'use server'` 的 action 邊界；`actions/settings.ts` 的 `getChainStatusAction`
 * 只是包一層管理員身分檢查，供將來要在用戶端重新整理時使用。
 */

export type ChainLayerStatusKind = 'ready' | 'circuit_open' | 'disabled';

export interface ChainLayerView {
  id: string;
  label: string;
  transport: 'direct' | 'gateway';
  upstream: string;
  model: string;
  status: ChainLayerStatusKind;
  purpose: string;
  completed30d: number;
  failed30d: number;
  lastEvent: { at: string; ok: boolean; category: ChainErrorCategory | null } | null;
}

export interface ChainStatusView {
  layers: ChainLayerView[];
  /** 最後一個「已啟用」的層在近 30 天內是否有成功紀錄——有就代表前面的層都失敗過。 */
  lastEnabledLayerSucceededRecently: boolean;
  lastEnabledLayerLabel: string | null;
  errorCategoryRules: { category: ChainErrorCategory; label: string; judgedBy: string; behavior: string }[];
}

export async function getChainStatus(ai: AiSettings): Promise<ChainStatusView> {
  const layerDefs = buildChainLayers(ai);
  const stats = await getChainLayerStats(layerDefs.map((layer) => layer.id));

  const layers: ChainLayerView[] = layerDefs.map((layer) => {
    const stat = stats[layer.id];
    const status: ChainLayerStatusKind = !layer.enabled
      ? 'disabled'
      : isCircuitOpen(layer.id)
        ? 'circuit_open'
        : 'ready';
    return {
      id: layer.id,
      label: layer.label,
      transport: layer.transport,
      upstream: layer.upstream,
      model: layer.model,
      status,
      purpose: layer.enabled ? layer.purpose : `${layer.purpose}（目前停用：${layer.disabledReason}）`,
      completed30d: stat?.completed30d ?? 0,
      failed30d: stat?.failed30d ?? 0,
      lastEvent: stat?.lastEvent
        ? {
            at: stat.lastEvent.createdAt.toISOString(),
            ok: stat.lastEvent.ok,
            category: stat.lastEvent.errorCategory,
          }
        : null,
    };
  });

  const enabledLayers = layers.filter((layer) => layer.status !== 'disabled');
  const lastEnabledLayer = enabledLayers.length > 0 ? enabledLayers[enabledLayers.length - 1] : null;
  const lastEnabledLayerSucceededRecently = lastEnabledLayer ? lastEnabledLayer.completed30d > 0 : false;

  const errorCategoryRules = (Object.keys(CHAIN_ERROR_CATEGORY_INFO) as ChainErrorCategory[]).map(
    (category) => ({ category, ...CHAIN_ERROR_CATEGORY_INFO[category] }),
  );

  return {
    layers,
    lastEnabledLayerSucceededRecently,
    lastEnabledLayerLabel: lastEnabledLayer?.label ?? null,
    errorCategoryRules,
  };
}
