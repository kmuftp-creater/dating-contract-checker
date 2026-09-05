'use client';

import { useMemo, useRef, useState, useTransition } from 'react';

import { MarkdownView } from '@/components/markdown-view';
import { extractChecklistIds } from '@/lib/ai/checklist';
import { DOCUMENT_LABELS, LEGAL_KINDS, LEGAL_TOKEN_HINTS } from '@/lib/document-labels';
import type { DocumentKind } from '@/lib/types';

import {
  publishAction,
  saveDraftAction,
  setSourceAction,
  type DocumentVersionView,
} from '../actions';

/**
 * 「法規文件」編輯頁的互動主體。
 *
 * 為什麼獨立成這一支檔案：`page.tsx` 是需要 `requireAdmin()` 與資料庫
 * 查詢的伺服端元件，而可編輯的文字框、即時預覽、發布二次確認這些都需要
 * 用戶端狀態；Next.js App Router 的 `'use client'` 是整份檔案的邊界，
 * 無法只讓檔案裡的一部分變成用戶端元件，因此互動主體只能拆到另一個檔案。
 */


function formatDateTime(iso: string | null): string {
  if (!iso) return '－';
  return new Date(iso).toLocaleString('zh-TW', { hour12: false });
}

/** 今天的日期（台北時間），格式為 YYYY-MM-DD，供日期輸入框當預設值。 */
function todayInTaipei(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 把版本號輸入框的字串轉成數字；空白或非法值回傳 undefined，交給後端用自動編號。 */
function parseVersion(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export function DocumentEditor({
  kind,
  versions: initialVersions,
}: {
  kind: DocumentKind;
  versions: DocumentVersionView[];
}) {
  const [versions, setVersions] = useState(initialVersions);
  const published = useMemo(() => versions.find((version) => version.isPublished) ?? null, [versions]);

  const [markdown, setMarkdown] = useState(published?.markdown ?? '');
  const [note, setNote] = useState('');

  // 版本號與生效日期預先帶入自動值，但允許覆寫。
  // 開放覆寫的理由：法規的版本編號是官方決定的，不是我們的流水號；
  // 官方發第 3 版而系統剛好排到第 5 版時，兩邊對不起來會誤導人。
  const autoVersion =
    initialVersions.length > 0
      ? Math.max(...initialVersions.map((item) => item.version)) + 1
      : 1;
  const [versionInput, setVersionInput] = useState(String(autoVersion));
  // 輸入的版本號若已經存在，發布是「覆蓋那一版」而不是新增一版。
  // 管理員必須在按下去之前就看到這件事，不能等結果出來才知道內容被換掉。
  const existingVersion = useMemo(() => {
    const parsed = parseVersion(versionInput);
    if (parsed === undefined) return null;
    return versions.find((item) => item.version === parsed) ?? null;
  }, [versionInput, versions]);
  const [publishedAtInput, setPublishedAtInput] = useState(todayInTaipei());
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [sourceUrl, setSourceUrl] = useState(published?.sourceUrl ?? '');
  const [sourceLabel, setSourceLabel] = useState(published?.sourceLabel ?? '');
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [isSourcePending, startSourceTransition] = useTransition();

  // 每次生效版本切換（例如剛發布了新版本），來源連結欄位改跟著新的生效版本
  // 走，不沿用舊版本輸入到一半的值。這是「渲染時依 props 調整 state」的
  // React 建議寫法，不用 useEffect：於渲染期間比對上一次同步過的版本 id，
  // 不同就在渲染中直接呼叫 setState，React 會捨棄本次渲染結果立即重渲染，
  // 不會有額外的畫面閃爍。
  const [syncedPublishedId, setSyncedPublishedId] = useState(published?.id ?? null);
  if (published?.id !== syncedPublishedId) {
    setSyncedPublishedId(published?.id ?? null);
    setSourceUrl(published?.sourceUrl ?? '');
    setSourceLabel(published?.sourceLabel ?? '');
    setSourceMessage(null);
    setSourceError(null);
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const viewing = viewingId ? (versions.find((version) => version.id === viewingId) ?? null) : null;
  const displayedMarkdown = viewing ? viewing.markdown : markdown;
  const isReadOnly = viewing !== null;

  const checklistIds = kind === 'checklist' ? extractChecklistIds(displayedMarkdown) : null;

  function handleSaveDraft(): void {
    setErrorMessage(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveDraftAction(kind, markdown, note, parseVersion(versionInput));
        if (!result.ok) {
          setErrorMessage(result.message);
          return;
        }
        const draft = result.data;
        setVersions((prev) => [draft, ...prev]);
        setNote('');
        setMessage(`已儲存第 ${draft.version} 版草稿，尚未發布。`);
      } catch {
        // 走到這裡代表連伺服器動作本身都沒跑起來（網路中斷、部署中），
        // 預期內的驗證錯誤已經在上面用回傳值處理掉了。
        setErrorMessage('儲存草稿失敗，請確認網路連線後再試一次。');
      }
    });
  }

  function handlePublish(): void {
    if (!confirmPublish) return;
    setErrorMessage(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await publishAction(
          kind,
          markdown,
          note,
          parseVersion(versionInput),
          publishedAtInput,
        );
        if (!result.ok) {
          setErrorMessage(result.message);
          return;
        }
        const publishedVersion = result.data;
        setVersions((prev) => [
          publishedVersion,
          ...prev.map((version) => ({ ...version, isPublished: false })),
        ]);
        setNote('');
        setConfirmPublish(false);
        setMessage(`第 ${publishedVersion.version} 版已發布為生效版本。`);
      } catch {
        setErrorMessage('發布失敗，請確認網路連線後再試一次。');
      }
    });
  }

  /**
   * 儲存官方來源連結：對象固定是目前生效版本，不是編輯中的草稿內容。
   * 前台 `/regulations` 頁只讀取生效版本的來源連結，草稿即使儲存了
   * 連結也不會有前台效果，因此這裡不提供對草稿設定來源連結的入口。
   */
  function handleSaveSource(): void {
    if (!published) return;
    setSourceError(null);
    setSourceMessage(null);
    startSourceTransition(async () => {
      try {
        const result = await setSourceAction(published.id, sourceUrl, sourceLabel);
        if (!result.ok) {
          setSourceError(result.message);
          return;
        }
        const updated = result.data;
        setVersions((prev) =>
          prev.map((version) => (version.id === updated.id ? updated : version)),
        );
        setSourceMessage(
          updated.sourceUrl ? '已儲存官方來源連結。' : '已移除官方來源連結。',
        );
      } catch {
        setSourceError('儲存來源連結失敗，請確認網路連線後再試一次。');
      }
    });
  }

  /**
   * 上傳 PDF 產生草稿：抽文字後交給 AI 依現行版本格式重排，結果只回填
   * 到編輯框，不自動儲存也不自動發布，管理員仍須自行檢查、儲存草稿或發布。
   */
  async function handleImportFile(): Promise<void> {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setImportError('請先選擇要上傳的 PDF 檔案。');
      return;
    }

    setImportError(null);
    setImportMessage(null);
    setIsImporting(true);

    try {
      const formData = new FormData();
      formData.append('kind', kind);
      formData.append('file', file);

      const response = await fetch('/admincenter/documents/import', {
        method: 'POST',
        body: formData,
      });

      const payload: { markdown?: string; checklistIdCount?: number; error?: string } =
        await response.json();

      if (!response.ok || !payload.markdown) {
        throw new Error(payload.error ?? '產生草稿失敗。');
      }

      setMarkdown(payload.markdown);
      setViewingId(null);
      setImportMessage(
        `已產生草稿並帶入編輯框，可解析出 ${payload.checklistIdCount ?? 0} 個查核項次，請檢查後再儲存草稿或發布。`,
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '產生草稿失敗。');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {viewing && (
        <div className="card flex flex-wrap items-center gap-3 border border-warn/40 p-4 text-sm">
          <span className="text-ink">
            正在唯讀檢視第 {viewing.version} 版（{formatDateTime(viewing.createdAt)}），內容不會覆蓋目前草稿。
          </span>
          <button
            type="button"
            onClick={() => setViewingId(null)}
            className="ml-auto rounded-(--radius-control) border border-hairline px-3 py-1.5 text-ink-muted transition-colors hover:text-ink"
          >
            返回編輯
          </button>
        </div>
      )}

      {LEGAL_KINDS.includes(kind) && (
        <div className="card p-4 text-sm">
          <p className="font-medium text-ink">可用變數</p>
          <p className="mt-1 text-ink-muted">
            下列變數會在顯示時換成目前的系統設定值。用變數而不是直接寫數字，
            後台改了設定條款就會跟著對，不會出現條款寫一套、系統做另一套。
          </p>
          <ul className="mt-3 space-y-1.5">
            {LEGAL_TOKEN_HINTS.map((item) => (
              <li key={item.token} className="flex flex-wrap gap-x-2">
                <code className="rounded-(--radius-control) bg-canvas px-1.5 py-0.5 font-mono text-ink">
                  {item.token}
                </code>
                <span className="text-ink-muted">{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {kind === 'checklist' && checklistIds && (
        <div
          className={
            checklistIds.length === 0
              ? 'card border border-danger/50 bg-danger/10 p-4 text-sm text-danger'
              : 'card p-4 text-sm text-ink-muted'
          }
        >
          {checklistIds.length === 0
            ? '目前可解析出 0 個查核項次：格式不符，AI 漏判偵測會失效。請確認表格第一欄是否為合法項次（例如 1、2-1、B-3）。'
            : `目前可解析出 ${checklistIds.length} 個查核項次。`}
        </div>
      )}

      <div className="card space-y-3 p-4">
        <p className="text-sm font-medium text-ink">上傳 PDF 產生草稿</p>
        <p className="text-sm text-ink-muted">
          內政部只發布 PDF，這裡會抽出文字後交給 AI 依現行生效版本的表格格式重排成
          markdown，產出的內容只會帶入下方編輯框，不會自動儲存，也不會自動發布，請務必檢查後再儲存草稿或發布。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            disabled={isImporting || isReadOnly}
            className="text-sm text-ink-muted file:mr-3 file:rounded-(--radius-control) file:border file:border-hairline file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
          <button
            type="button"
            onClick={handleImportFile}
            disabled={isImporting || isReadOnly}
            className="rounded-(--radius-control) border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? '處理中…' : '產生草稿'}
          </button>
        </div>
        {importMessage && <p className="text-sm text-ok">{importMessage}</p>}
        {importError && <p className="text-sm text-danger">{importError}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <label htmlFor="document-markdown" className="mb-2 block text-sm font-medium text-ink">
            Markdown 內容
          </label>
          <textarea
            id="document-markdown"
            value={displayedMarkdown}
            readOnly={isReadOnly}
            onChange={(event) => setMarkdown(event.target.value)}
            rows={24}
            spellCheck={false}
            className="h-[60vh] min-h-96 w-full resize-y rounded-(--radius-control) border border-hairline bg-canvas p-3 font-mono text-sm text-ink"
          />
        </div>

        <div className="card p-4">
          <p className="mb-2 text-sm font-medium text-ink">即時預覽</p>
          <div className="h-[60vh] min-h-96 overflow-y-auto rounded-(--radius-control) border border-hairline p-3">
            <MarkdownView markdown={displayedMarkdown} />
          </div>
        </div>
      </div>

      <div className="card space-y-4 p-4">
        <div>
          <label htmlFor="document-note" className="mb-2 block text-sm font-medium text-ink">
            備註（選填）
          </label>
          <input
            id="document-note"
            type="text"
            value={note}
            disabled={isReadOnly}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：修正第 5 項文字"
            className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink disabled:opacity-50"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="document-version" className="mb-2 block text-sm font-medium text-ink">
              版本號
            </label>
            <input
              id="document-version"
              type="number"
              min={1}
              step={1}
              value={versionInput}
              disabled={isReadOnly}
              onChange={(event) => setVersionInput(event.target.value)}
              className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink disabled:opacity-50"
            />
            {existingVersion ? (
              <p className="mt-1 text-xs text-warn">
                第 {existingVersion.version} 版已經存在
                {existingVersion.isPublished ? '（目前生效中）' : '（草稿）'}
                。發布會<strong>覆蓋它的內容</strong>，原本的內容不會保留。
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">
                已預先帶入下一個號碼。官方版本編號與系統流水號不同時，改成官方的號碼；
                填已存在的號碼則是覆蓋那一版。
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="document-published-at"
              className="mb-2 block text-sm font-medium text-ink"
            >
              生效日期
            </label>
            <input
              id="document-published-at"
              type="date"
              value={publishedAtInput}
              disabled={isReadOnly}
              onChange={(event) => setPublishedAtInput(event.target.value)}
              className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-ink-muted">
              已預先帶入今天。發布時才會採用，儲存草稿不受影響。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isPending || isReadOnly}
            className="rounded-(--radius-control) border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            儲存草稿
          </button>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={confirmPublish}
              disabled={isReadOnly}
              onChange={(event) => setConfirmPublish(event.target.checked)}
            />
            {existingVersion
              ? `我確認要發布，這會覆蓋第 ${existingVersion.version} 版的內容並讓它生效`
              : '我確認要發布，這會立即取代目前生效版本'}
          </label>

          <button
            type="button"
            onClick={handlePublish}
            disabled={isPending || !confirmPublish || isReadOnly}
            className="rounded-(--radius-control) bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            發布為生效版本
          </button>
        </div>

        {message && <p className="text-sm text-ok">{message}</p>}
        {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}
      </div>

      <div className="card space-y-4 p-4">
        <div>
          <p className="text-sm font-medium text-ink">官方來源連結</p>
          <p className="mt-1 text-sm text-ink-muted">
            設定的對象是目前生效版本（第 {published ? published.version : '－'} 版），前台
            /regulations 頁會顯示這個連結；本站已不再提供 .md 或原檔下載。
          </p>
        </div>

        {!published && (
          <p className="rounded-(--radius-control) border border-warn/50 bg-warn/10 p-3 text-sm text-ink">
            尚無生效版本，請先發布後再設定來源連結。
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="document-source-url" className="mb-2 block text-sm font-medium text-ink">
              官方來源網址
            </label>
            <input
              id="document-source-url"
              type="text"
              value={sourceUrl}
              disabled={!published || isSourcePending}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://www.moi.gov.tw/…（留空表示移除連結）"
              className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink disabled:opacity-50"
            />
          </div>
          <div>
            <label
              htmlFor="document-source-label"
              className="mb-2 block text-sm font-medium text-ink"
            >
              顯示名稱（選填）
            </label>
            <input
              id="document-source-label"
              type="text"
              value={sourceLabel}
              disabled={!published || isSourcePending}
              onChange={(event) => setSourceLabel(event.target.value)}
              placeholder="例如：內政部公告頁"
              className="w-full rounded-(--radius-control) border border-hairline bg-canvas px-3 py-2 text-sm text-ink disabled:opacity-50"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSaveSource}
          disabled={!published || isSourcePending}
          className="rounded-(--radius-control) border border-hairline px-4 py-2 text-sm text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          儲存來源連結
        </button>

        {sourceMessage && <p className="text-sm text-ok">{sourceMessage}</p>}
        {sourceError && <p className="text-sm text-danger">{sourceError}</p>}
      </div>

      <div className="card p-4">
        <p className="mb-3 text-sm font-medium text-ink">版本歷史</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-hairline text-ink-muted">
                <th className="px-3 py-2 font-semibold">版本</th>
                <th className="px-3 py-2 font-semibold">建立時間</th>
                <th className="px-3 py-2 font-semibold">是否生效</th>
                <th className="px-3 py-2 font-semibold">備註</th>
                <th className="px-3 py-2 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2 text-ink">第 {version.version} 版</td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-muted">
                    {formatDateTime(version.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    {version.isPublished ? (
                      <span className="text-ok">生效中</span>
                    ) : (
                      <span className="text-ink-muted">－</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{version.note || '－'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setViewingId(version.id)}
                      className="text-brand hover:underline"
                    >
                      唯讀檢視
                    </button>
                  </td>
                </tr>
              ))}
              {versions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-ink-muted">
                    尚無任何版本。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        {DOCUMENT_LABELS[kind]}　共 {versions.length} 個版本
      </p>
    </div>
  );
}
