import { redirect } from 'next/navigation';

import { getChainStatus } from '@/lib/ai/chain-status';
import { requireAdmin } from '@/auth';
import { getSetting } from '@/lib/settings';

import { AiProviderConsole, OtherSettingsPanel } from './ai-settings-panel';
import { ChainStatusSection } from './chain-status-section';
import { toAiSettingsView } from './view';

/**
 * 「AI 設定」頁：CostScale 閘道（Gemini）與 Groq 兩家供應商的卡片式設定，
 * 版面與互動細節照 admin-ai-service-console 技能規格（左窄右寬、選擇卡片
 * 不等於啟用、金鑰只回尾碼）。下方接續備援鏈狀態、濫用規則、保留期。
 */

export const metadata = { title: 'AI 設定' };
export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  const user = await requireAdmin();
  if (!user) {
    redirect('/admincenter/login');
  }

  const [ai, abuseRules, retention] = await Promise.all([
    getSetting('ai'),
    getSetting('abuse_rules'),
    getSetting('retention'),
  ]);
  const chainStatus = await getChainStatus(ai);
  const aiView = toAiSettingsView(ai);

  return (
    <div className="space-y-8">
      <div>
        <span className="inline-flex items-center rounded-full border border-info/40 bg-info/10 px-2.5 py-1 text-xs font-medium text-info">
          Server-side 加密保存
        </span>
        <h1 className="mt-3 text-2xl font-semibold text-ink">AI 供應商與模型</h1>
        <p className="mt-1 max-w-[42rem] text-sm text-ink-muted">
          選擇 CostScale 閘道（Gemini）或 Groq，輸入金鑰後可讀取可用模型、測試真實生成、執行診斷。任一供應商失敗時，系統會依下方「備援鏈狀態」自動改用下一層，不會整個中斷——但也不會假造結果，全部層都失敗一律明確回報失敗。
        </p>
      </div>

      <AiProviderConsole initialGateway={aiView.gateway} initialGroq={aiView.groq} />

      <ChainStatusSection status={chainStatus} />

      <OtherSettingsPanel initialAbuseRules={abuseRules} initialRetention={retention} />
    </div>
  );
}
