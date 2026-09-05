/**
 * 服務啟動時的自我檢查。
 *
 * 設定有矛盾時就讓服務起不來，而不是安靜地跑出錯誤行為。
 * Next.js 會在伺服器啟動時自動呼叫這個檔案的 register。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { env, assertEnvConsistency, isPublicEdition } = await import('@/lib/env');

  assertEnvConsistency();

  if (isPublicEdition) {
    // `EDITION=public` 的部署不會把任何資料送到外部端點。
    //
    // 這裡攔的是「設定與行為不一致」：有人填了這些環境變數，代表他預期
    // 系統會往外送東西，而這份程式不會。與其讓他以為有在送，不如直接
    // 拒絕啟動並說明原因。
    //
    // 真正的保證在 `src/lib/email/hooks.ts`（沒有掛任何擴充）與
    // `src/lib/settings.ts`（相關設定一律拒寫）。這道檢查是額外的一層。
    const unexpected = ['TELEMETRY_URL', 'FORWARD_URL', 'REPORT_ENDPOINT'].filter(
      (key) => Boolean(process.env[key]),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `EDITION=public 的部署不會把資料送到外部端點，但偵測到：${unexpected.join('、')}。` +
          '請移除這些環境變數後重新啟動。',
      );
    }
  }

  const adminLocation =
    env.adminHost && env.adminHost !== env.publicHost
      ? `獨立網域 ${env.adminHost}`
      : `${env.publicHost}/admincenter`;
  console.info(`[啟動] 版本 ${env.edition}／前台 ${env.publicHost}／後台 ${adminLocation}`);

  // 以下都只在真正的 Node 執行環境、且不是 `next build` 的建置階段時執行，
  // 避免建置過程卡住等待資料庫連線或無限輪詢。
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    // 先把資料庫準備好（套用遷移、必要時匯入初始法規），再開始收工作。
    // 遷移失敗會往外拋，讓服務直接起不來，而不是帶著不完整的結構繼續跑。
    const { prepareDatabase } = await import('@/lib/startup');
    await prepareDatabase();

    const { startWorker } = await import('@/lib/worker/start');
    startWorker();
  }
}
