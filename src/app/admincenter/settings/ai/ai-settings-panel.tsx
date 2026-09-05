'use client';

import { Info, KeyRound, Loader2, ListChecks, Radio, Wifi } from 'lucide-react';
import { useState, useTransition } from 'react';

import type { AbuseRulesSettings, RetentionSettings } from '@/lib/settings';

import {
  diagnoseGatewayAction,
  diagnoseGroqAction,
  fetchGatewayModelsAction,
  fetchGroqModelsAction,
  testGatewayGenerationAction,
  testGroqGenerationAction,
  updateAbuseRulesAction,
  updateGatewaySettingsAction,
  updateGroqSettingsAction,
  updateRetentionAction,
  type DiagnosisResult,
  type GroqGenerationTestView,
  type ProviderTestResult,
} from '../../actions/settings';
import type { GatewayProviderView, GroqProviderView } from './view';

/**
 * 「AI 供應商與模型」的互動主體。
 *
 * 版面依 admin-ai-service-console 技能規格：左欄是供應商卡片的縱向清單，
 * 點選只切換右欄檢視，不等於啟用；右欄依選中的供應商顯示對應表單。
 * CostScale 閘道與 Groq 各自的四個動作（讀取可用模型、保存、測試真實
 * 生成、執行診斷）各有獨立的忙碌狀態，彼此不共用同一個 `loading`。
 */

function numberField(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueOptions(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))];
}

type ProviderKind = 'gateway' | 'groq';

// ---------------------------------------------------------------------------
// 主控台：左欄卡片清單 ＋ 右欄表單
// ---------------------------------------------------------------------------

export function AiProviderConsole({
  initialGateway,
  initialGroq,
}: {
  initialGateway: GatewayProviderView;
  initialGroq: GroqProviderView;
}) {
  const [selected, setSelected] = useState<ProviderKind>('gateway');
  const [gatewayView, setGatewayView] = useState(initialGateway);
  const [groqView, setGroqView] = useState(initialGroq);

  return (
    <div className="grid grid-cols-1 gap-4 [@media(min-width:860px)]:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">選擇供應商</p>

        <ProviderCard
          name="CostScale 閘道（Gemini）"
          description="OpenAI 相容閘道，需要虛擬金鑰；支援圖片，是備援鏈的主力層。"
          savedLine={gatewayView.hasApiKey ? `已保存尾碼 ${gatewayView.apiKeyTail}` : null}
          active={gatewayView.active}
          selected={selected === 'gateway'}
          onSelect={() => setSelected('gateway')}
        />
        <ProviderCard
          name="Groq（直連）"
          description="純文字分析可用的低延遲直連上游，需要至少一支金鑰；不支援圖片。"
          savedLine={groqView.keyCount > 0 ? `已保存 ${groqView.keyCount} 支金鑰` : null}
          active={groqView.active}
          selected={selected === 'groq'}
          onSelect={() => setSelected('groq')}
        />
      </div>

      <div>
        {selected === 'gateway' ? (
          <GatewayProviderForm view={gatewayView} onSaved={setGatewayView} />
        ) : (
          <GroqProviderForm view={groqView} onSaved={setGroqView} />
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  name,
  description,
  savedLine,
  active,
  selected,
  onSelect,
}: {
  name: string;
  description: string;
  savedLine: string | null;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-(--radius-card) border p-3 text-left transition-colors ${
        selected ? 'border-brand bg-brand/10' : 'border-hairline bg-surface hover:border-brand/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-ink">{name}</p>
        {active && (
          <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-medium text-ok">啟用中</span>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">{description}</p>
      {savedLine && <p className="mt-1 text-xs text-ink-muted">{savedLine}</p>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CostScale 閘道表單
// ---------------------------------------------------------------------------

function GatewayProviderForm({
  view,
  onSaved,
}: {
  view: GatewayProviderView;
  onSaved: (view: GatewayProviderView) => void;
}) {
  const [gatewayUrl, setGatewayUrl] = useState(view.gatewayUrl);
  const [apiKey, setApiKey] = useState('');
  const [primaryModel, setPrimaryModel] = useState(view.primaryModel);
  const [fallbackModel, setFallbackModel] = useState(view.fallbackModel);
  const [maxInputTokens, setMaxInputTokens] = useState(String(view.maxInputTokens));
  const [costClientId, setCostClientId] = useState(view.costClientId);
  const [modelOptions, setModelOptions] = useState<string[]>(
    uniqueOptions([view.primaryModel, view.fallbackModel]),
  );

  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isModelsPending, startModelsTransition] = useTransition();

  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavePending, startSaveTransition] = useTransition();

  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [isTestPending, startTestTransition] = useTransition();

  const [diagResult, setDiagResult] = useState<DiagnosisResult | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [isDiagPending, startDiagTransition] = useTransition();

  function handleFetchModels(): void {
    setModelsMessage(null);
    setModelsError(null);
    startModelsTransition(async () => {
      try {
        const result = await fetchGatewayModelsAction({
          gatewayUrl: gatewayUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        });
        if (!result.ok) {
          setModelsError(result.error);
          return;
        }
        setModelOptions(uniqueOptions([...result.models, primaryModel, fallbackModel]));
        setModelsMessage(`已讀取 ${result.models.length} 個模型，回填到下方下拉建議清單。`);
      } catch (error) {
        setModelsError(errorMessage(error));
      }
    });
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSaveError(null);
    setSaveMessage(null);
    startSaveTransition(async () => {
      try {
        const result = await updateGatewaySettingsAction({
          gatewayUrl,
          apiKey,
          primaryModel,
          fallbackModel,
          maxInputTokens: numberField(maxInputTokens, view.maxInputTokens),
          costClientId,
        });
        if (!result.ok) {
          setSaveError(result.message);
          return;
        }
        const updated = result.data;
        onSaved(updated);
        setApiKey('');
        setSaveMessage(updated.active ? '已保存並啟用 CostScale 閘道設定。' : '已保存 CostScale 閘道設定。');
      } catch (error) {
        setSaveError(errorMessage(error));
      }
    });
  }

  function handleTest(): void {
    setTestResult(null);
    setTestError(null);
    startTestTransition(async () => {
      try {
        const result = await testGatewayGenerationAction({
          gatewayUrl: gatewayUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          model: primaryModel.trim() || undefined,
        });
        setTestResult(result);
      } catch (error) {
        setTestError(errorMessage(error));
      }
    });
  }

  function handleDiagnose(): void {
    setDiagResult(null);
    setDiagError(null);
    startDiagTransition(async () => {
      try {
        const result = await diagnoseGatewayAction({
          gatewayUrl: gatewayUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          model: primaryModel.trim() || undefined,
        });
        setDiagResult(result);
      } catch (error) {
        setDiagError(errorMessage(error));
      }
    });
  }

  return (
    <form onSubmit={handleSave} className="card space-y-4 p-4 [@media(max-width:640px)]:p-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-ink-muted" aria-hidden />
        <div>
          <p className="text-sm font-medium text-ink">CostScale 閘道（Gemini）</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {view.hasApiKey ? `目前已保存的金鑰尾碼：${view.apiKeyTail}` : '目前尚未保存金鑰。'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="閘道網址" htmlFor="gw-url">
          <input
            id="gw-url"
            type="text"
            value={gatewayUrl}
            onChange={(event) => setGatewayUrl(event.target.value)}
            placeholder="https://…"
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
        </Field>
        <Field label="API Key（留空表示不修改已保存的金鑰）" htmlFor="gw-key">
          <input
            id="gw-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={view.hasApiKey ? `已保存，尾碼 ${view.apiKeyTail}` : '尚未設定'}
            autoComplete="off"
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
        </Field>
        <Field label="每次分析輸入 token 上限（超過時先截斷合約文字）" htmlFor="gw-max-tokens">
          <input
            id="gw-max-tokens"
            type="number"
            min={1}
            value={maxInputTokens}
            onChange={(event) => setMaxInputTokens(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
        </Field>
        <Field label="成本歸戶識別碼（回傳給閘道做用量分類）" htmlFor="gw-cost-client">
          <input
            id="gw-cost-client"
            type="text"
            value={costClientId}
            onChange={(event) => setCostClientId(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
        </Field>
      </div>

      <div>
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={isModelsPending}
          className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isModelsPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ListChecks className="size-4" aria-hidden />
          )}
          {isModelsPending ? '讀取中…' : '讀取可用模型'}
        </button>
        {modelsMessage && <p className="mt-2 text-sm text-ok">{modelsMessage}</p>}
        {modelsError && <p className="mt-2 text-sm text-danger">{modelsError}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="主要模型" htmlFor="gw-primary-model">
          <input
            id="gw-primary-model"
            list="gw-model-options"
            type="text"
            value={primaryModel}
            onChange={(event) => setPrimaryModel(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
        </Field>
        <Field label="備援模型（主要模型連續失敗時改用）" htmlFor="gw-fallback-model">
          <input
            id="gw-fallback-model"
            list="gw-model-options"
            type="text"
            value={fallbackModel}
            onChange={(event) => setFallbackModel(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
        </Field>
        <datalist id="gw-model-options">
          {modelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <button
          type="submit"
          disabled={isSavePending}
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSavePending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isSavePending ? '保存中…' : '保存 AI 設定'}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={isTestPending}
          className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isTestPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isTestPending ? '測試中…' : '測試真實生成'}
        </button>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleDiagnose}
            disabled={isDiagPending}
            className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDiagPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isDiagPending ? '診斷中…' : '執行診斷'}
          </button>
          <p className="text-xs text-ink-muted">會向 api.ipify.org 查詢本機的對外 IP。</p>
        </div>
      </div>

      {saveMessage && <p className="text-sm text-ok">{saveMessage}</p>}
      {saveError && <p className="text-sm text-danger">{saveError}</p>}

      {testError && <p className="text-sm text-danger">{testError}</p>}
      {testResult && <TestResultBox result={testResult} />}

      {diagError && <p className="text-sm text-danger">{diagError}</p>}
      {diagResult && <DiagnosisBox result={diagResult} />}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Groq 表單
// ---------------------------------------------------------------------------

function GroqProviderForm({
  view,
  onSaved,
}: {
  view: GroqProviderView;
  onSaved: (view: GroqProviderView) => void;
}) {
  const [enabled, setEnabled] = useState(view.enabled);
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [model, setModel] = useState(view.model);
  const [apiKeysText, setApiKeysText] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>(uniqueOptions([view.model]));

  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isModelsPending, startModelsTransition] = useTransition();

  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavePending, startSaveTransition] = useTransition();

  const [testResults, setTestResults] = useState<GroqGenerationTestView[] | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [isTestPending, startTestTransition] = useTransition();

  const [diagResult, setDiagResult] = useState<DiagnosisResult | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [isDiagPending, startDiagTransition] = useTransition();

  function handleFetchModels(): void {
    setModelsMessage(null);
    setModelsError(null);
    startModelsTransition(async () => {
      try {
        const result = await fetchGroqModelsAction({
          baseUrl: baseUrl.trim() || undefined,
          apiKeysText: apiKeysText.trim() || undefined,
        });
        if (!result.ok) {
          setModelsError(result.error);
          return;
        }
        setModelOptions(uniqueOptions([...result.models, model]));
        setModelsMessage(`已讀取 ${result.models.length} 個模型，回填到下方下拉建議清單。`);
      } catch (error) {
        setModelsError(errorMessage(error));
      }
    });
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSaveError(null);
    setSaveMessage(null);
    startSaveTransition(async () => {
      try {
        const result = await updateGroqSettingsAction({
          enabled,
          apiKeysText,
          baseUrl,
          model,
        });
        if (!result.ok) {
          setSaveError(result.message);
          return;
        }
        const updated = result.data;
        onSaved(updated);
        setApiKeysText('');
        setEnabled(updated.enabled);
        setSaveMessage(updated.active ? '已保存並啟用 Groq 設定。' : '已保存 Groq 設定。');
      } catch (error) {
        setSaveError(errorMessage(error));
      }
    });
  }

  function handleTest(): void {
    setTestResults(null);
    setTestError(null);
    startTestTransition(async () => {
      try {
        const results = await testGroqGenerationAction({
          baseUrl: baseUrl.trim() || undefined,
          apiKeysText: apiKeysText.trim() || undefined,
          model: model.trim() || undefined,
        });
        if (results.length === 0) {
          setTestError('目前沒有可測試的 Groq 金鑰，請先在下方文字框填入金鑰或保存過至少一支。');
          return;
        }
        setTestResults(results);
      } catch (error) {
        setTestError(errorMessage(error));
      }
    });
  }

  function handleDiagnose(): void {
    setDiagResult(null);
    setDiagError(null);
    startDiagTransition(async () => {
      try {
        const result = await diagnoseGroqAction({
          baseUrl: baseUrl.trim() || undefined,
          apiKeysText: apiKeysText.trim() || undefined,
          model: model.trim() || undefined,
        });
        setDiagResult(result);
      } catch (error) {
        setDiagError(errorMessage(error));
      }
    });
  }

  return (
    <form onSubmit={handleSave} className="card space-y-4 p-4 [@media(max-width:640px)]:p-3">
      <div className="flex items-center gap-2">
        <Radio className="size-4 text-ink-muted" aria-hidden />
        <div>
          <p className="text-sm font-medium text-ink">Groq（直連）</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            目前有 {view.keyCount} 支金鑰
            {view.keyCount > 0 ? `：${view.keyTails.map((tail) => `…${tail}`).join('、')}` : '。'}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-(--radius-control) border border-info/40 bg-info/10 p-3 text-sm text-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <p>
          純文字分析在啟用後才會先隨機挑一支金鑰嘗試，失敗就換下一支，全部失敗才退回 CostScale 閘道。
          帶圖片的分析一律直接走閘道，不會使用 Groq——Groq 支援影像的模型單次最多只能帶 3 到 5
          張圖片，掃描檔 PDF 可能一次就有多達 30 頁，Groq 視覺模型無法一次處理。
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-4 rounded border-hairline"
        />
        啟用 Groq 金鑰輪替
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Groq 模型（純文字，不支援影像）" htmlFor="groq-model">
          <input
            id="groq-model"
            list="groq-model-options"
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
          <datalist id="groq-model-options">
            {modelOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </Field>
        <Field label="Groq API 位址" htmlFor="groq-base-url">
          <input
            id="groq-base-url"
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
        </Field>
      </div>

      <div>
        <label htmlFor="groq-api-keys" className="mb-1 block text-sm text-ink">
          Groq 金鑰清單（一行一支，留空表示不修改；填了會整批取代目前的清單）
        </label>
        <textarea
          id="groq-api-keys"
          rows={5}
          value={apiKeysText}
          onChange={(event) => setApiKeysText(event.target.value)}
          placeholder="gsk_…"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 font-mono text-sm text-ink"
        />
      </div>

      <div>
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={isModelsPending}
          className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isModelsPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ListChecks className="size-4" aria-hidden />
          )}
          {isModelsPending ? '讀取中…' : '讀取可用模型'}
        </button>
        <p className="mt-1 text-xs text-ink-muted">用金鑰清單中的第一支去問供應商要模型清單。</p>
        {modelsMessage && <p className="mt-2 text-sm text-ok">{modelsMessage}</p>}
        {modelsError && <p className="mt-2 text-sm text-danger">{modelsError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <button
          type="submit"
          disabled={isSavePending}
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSavePending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isSavePending ? '保存中…' : '保存 AI 設定'}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={isTestPending}
          className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isTestPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {isTestPending ? '測試中…' : '測試真實生成'}
        </button>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleDiagnose}
            disabled={isDiagPending}
            className="btn-secondary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDiagPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {isDiagPending ? '診斷中…' : '執行診斷'}
          </button>
          <p className="text-xs text-ink-muted">
            會向 api.ipify.org 查詢本機的對外 IP；使用金鑰清單中的第一支做為診斷對象。
          </p>
        </div>
      </div>

      {saveMessage && <p className="text-sm text-ok">{saveMessage}</p>}
      {saveError && <p className="text-sm text-danger">{saveError}</p>}

      {testError && <p className="text-sm text-danger">{testError}</p>}
      {testResults && testResults.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {testResults.map((result) => (
            <li
              key={result.index}
              className={`rounded-(--radius-control) border p-2 ${
                result.ok ? 'border-ok/50 bg-ok/10 text-ink' : 'border-danger/50 bg-danger/10 text-danger'
              }`}
            >
              <p className="font-medium">
                第 {result.index} 支（…{result.keyTail}）：{result.ok ? '可用' : `失敗（${result.error}）`}
                {result.ok && `・延遲 ${result.latencyMs} 毫秒`}
              </p>
              {result.ok && result.reply && (
                <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-ink-muted">{result.reply}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {diagError && <p className="text-sm text-danger">{diagError}</p>}
      {diagResult && <DiagnosisBox result={diagResult} />}
    </form>
  );
}

// ---------------------------------------------------------------------------
// 共用結果呈現
// ---------------------------------------------------------------------------

function TestResultBox({ result }: { result: ProviderTestResult }) {
  return (
    <div
      className={`rounded-(--radius-control) border p-3 text-sm ${
        result.ok ? 'border-ok/50 bg-ok/10 text-ink' : 'border-danger/50 bg-danger/10 text-danger'
      }`}
    >
      {result.ok ? (
        <>
          <p>生成成功，延遲 {result.latencyMs} 毫秒。AI 回覆原文：</p>
          <p className="mt-1 whitespace-pre-wrap rounded-(--radius-control) bg-canvas p-2 font-mono text-xs text-ink">
            {result.reply || '（空白回覆）'}
          </p>
        </>
      ) : (
        <p>生成失敗：{result.error}</p>
      )}
    </div>
  );
}

function DiagnosisBox({ result }: { result: DiagnosisResult }) {
  return (
    <div
      className={`rounded-(--radius-control) border p-3 text-sm ${
        result.ok ? 'border-ok/50 bg-ok/10 text-ink' : 'border-danger/50 bg-danger/10 text-danger'
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5 font-medium">
        <Wifi className="size-4" aria-hidden />
        診斷結果：{result.ok ? '正常' : '異常'}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted">結果</dt>
          <dd className="text-ink">{result.ok ? '可連線' : `連不上（${result.error}）`}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">出口 IP</dt>
          <dd className="font-mono text-ink">{result.egressIp}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">延遲</dt>
          <dd className="text-ink">{result.latencyMs} 毫秒</dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 濫用規則、保留期（與供應商設定無關，維持原本設計）
// ---------------------------------------------------------------------------

export function OtherSettingsPanel({
  initialAbuseRules,
  initialRetention,
}: {
  initialAbuseRules: AbuseRulesSettings;
  initialRetention: RetentionSettings;
}) {
  return (
    <div className="space-y-6">
      <AbuseRulesCard initial={initialAbuseRules} />
      <RetentionCard initial={initialRetention} />
    </div>
  );
}

/**
 * 濫用規則裡「數值」欄位的鍵。
 *
 * 表單把這些欄位一律當數字輸入框處理，所以型別要把布林欄位
 * （`offTopicRuleEnabled`）排除掉，避免它被 `numberField()` 轉成 NaN。
 * 那個總開關另外用勾選框呈現。
 */
type NumericAbuseRuleKey = {
  [K in keyof AbuseRulesSettings]: AbuseRulesSettings[K] extends number ? K : never;
}[keyof AbuseRulesSettings];

const ABUSE_RULE_FIELDS: {
  key: NumericAbuseRuleKey;
  label: string;
  help: string;
}[] = [
  { key: 'r1UploadPer60s', label: 'R1：60 秒內上傳次數上限', help: '單一 IP 在 60 秒內上傳請求數超過這個次數就暫停使用。' },
  { key: 'r2AnalyzePer60s', label: 'R2：60 秒內分析次數上限', help: '單一 IP 在 60 秒內送出分析請求數超過這個次數就暫停使用。' },
  {
    key: 'r3RejectedPer10Min',
    label: 'R3：10 分鐘內失敗或被拒次數上限',
    help: '單一 IP 在 10 分鐘內失敗或被擋下的請求數超過這個次數就暫停使用。',
  },
  {
    key: 'r4SuspendCountPer24h',
    label: 'R4：24 小時內暫停次數上限',
    help: '單一 IP 在 24 小時內被暫停達這個次數，就自動把該 IP 加入封鎖清單。',
  },
  {
    key: 'r5DailyTokenLimit',
    label: 'R5：全站每日 token 上限',
    help: '全站當日消耗的 AI token 總量達到這個數字時，當天暫停所有人送出新的分析（成本熔斷）。',
  },
  {
    key: 'suspendDurationSeconds',
    label: '暫停時長（秒）',
    help: '觸發 R1 至 R4 任一條規則時，該來源會被暫停使用這麼多秒。',
  },
  {
    key: 'dailyAnalysisLimit',
    label: '每日分析次數上限',
    help: '每位使用者（依瀏覽器識別碼或 IP 計）每天最多可以送出這麼多次分析。',
  },
  { key: 'maxFilesPerBatch', label: '單次上傳檔案數上限', help: '一次分析最多可以附帶這麼多個檔案。' },
  { key: 'maxImageBytes', label: '單一圖片大小上限（位元組）', help: '單一圖片檔超過這個大小會被拒絕上傳。' },
  { key: 'maxDocumentBytes', label: '圖片以外單檔大小上限（位元組）', help: 'PDF、Word 等非圖片檔超過這個大小會被拒絕上傳。' },
  { key: 'maxPastedTextChars', label: '直接貼上文字長度上限（字元數）', help: '使用者直接貼上合約文字時，超過這個字數會被拒絕。' },
  {
    key: 'offTopicSuspendThreshold',
    label: '非目標文件：暫停門檻（累計次數）',
    help: '同一 IP 上傳非交友媒合服務契約累計達這個次數就暫停使用，時長沿用上方的「暫停時長」。第一次只會出現警告。',
  },
  {
    key: 'offTopicBlockThreshold',
    label: '非目標文件：封鎖門檻（累計次數）',
    help: '同一 IP 上傳非交友媒合服務契約累計達這個次數就自動加入封鎖清單。必須大於上面的暫停門檻。',
  },
];

function AbuseRulesCard({ initial }: { initial: AbuseRulesSettings }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(ABUSE_RULE_FIELDS.map((field) => [field.key, String(initial[field.key])])),
  );
  const [offTopicEnabled, setOffTopicEnabled] = useState(initial.offTopicRuleEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const patch = {
          ...Object.fromEntries(
            ABUSE_RULE_FIELDS.map((field) => [field.key, numberField(values[field.key], initial[field.key])]),
          ),
          offTopicRuleEnabled: offTopicEnabled,
        } as unknown as AbuseRulesSettings;
        const result = await updateAbuseRulesAction(patch);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const updated = result.data;
        setValues(Object.fromEntries(ABUSE_RULE_FIELDS.map((field) => [field.key, String(updated[field.key])])));
        setOffTopicEnabled(updated.offTopicRuleEnabled);
        setMessage('已儲存濫用規則設定。');
      } catch (submitError) {
        setError(errorMessage(submitError));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-4">
      <p className="text-sm font-medium text-ink">濫用規則</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ABUSE_RULE_FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={`abuse-${field.key}`} className="mb-1 block text-sm text-ink">
              {field.label}
            </label>
            <input
              id={`abuse-${field.key}`}
              type="number"
              min={1}
              value={values[field.key]}
              onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
              className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
            />
            <p className="mt-1 text-xs text-ink-muted">{field.help}</p>
          </div>
        ))}
      </div>
      <div className="rounded-(--radius-control) border border-hairline bg-canvas p-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={offTopicEnabled}
            onChange={(event) => setOffTopicEnabled(event.target.checked)}
            className="size-4 rounded border-hairline"
          />
          啟用非目標文件偵測
        </label>
        <p className="mt-1 text-xs text-ink-muted">
          開啟後，系統會在分析前先判斷上傳的內容是不是交友媒合服務契約。判定為不是時退還當次配額並顯示警告，
          累計次數達上方門檻才會暫停或封鎖。判斷不確定時一律放行，不會誤擋。關閉這個開關等於完全不做這項檢查。
        </p>
      </div>
      <button type="submit" disabled={isPending} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50">
        {isPending ? '儲存中…' : '儲存濫用規則'}
      </button>
      {message && <p className="text-sm text-ok">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}

function RetentionCard({ initial }: { initial: RetentionSettings }) {
  const [analysisResultDays, setAnalysisResultDays] = useState(String(initial.analysisResultDays));
  const [rawFileDays, setRawFileDays] = useState(String(initial.rawFileDays));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await updateRetentionAction({
          analysisResultDays: numberField(analysisResultDays, initial.analysisResultDays),
          rawFileDays: numberField(rawFileDays, initial.rawFileDays),
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const updated = result.data;
        setAnalysisResultDays(String(updated.analysisResultDays));
        setRawFileDays(String(updated.rawFileDays));
        setMessage('已儲存保留期設定。');
      } catch (submitError) {
        setError(errorMessage(submitError));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-4">
      <p className="text-sm font-medium text-ink">保留期</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="retention-analysis-days" className="mb-1 block text-sm text-ink">
            分析結果保留天數
          </label>
          <input
            id="retention-analysis-days"
            type="number"
            min={1}
            value={analysisResultDays}
            onChange={(event) => setAnalysisResultDays(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
          <p className="mt-1 text-xs text-ink-muted">超過這個天數的分析結果與查核項目會被清除，使用者無法再查看歷史紀錄。</p>
        </div>
        <div>
          <label htmlFor="retention-raw-file-days" className="mb-1 block text-sm text-ink">
            原始檔案保留天數
          </label>
          <input
            id="retention-raw-file-days"
            type="number"
            min={1}
            value={rawFileDays}
            onChange={(event) => setRawFileDays(event.target.value)}
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
          />
          <p className="mt-1 text-xs text-ink-muted">
            超過這個天數後只刪除使用者上傳的原始檔案本體，分析結果與已抽出的文字仍會保留到分析結果保留天數期滿。
          </p>
        </div>
      </div>
      <button type="submit" disabled={isPending} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50">
        {isPending ? '儲存中…' : '儲存保留期設定'}
      </button>
      {message && <p className="text-sm text-ok">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}
