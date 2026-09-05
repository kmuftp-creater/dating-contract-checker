import 'server-only';

import { startEmailQueue, stopEmailQueue } from '@/lib/email/jobs';

import { startQueue, stopQueue } from './queue';

/**
 * 背景佇列的啟動與停止入口，供 `src/instrumentation.ts` 呼叫。
 *
 * 只在伺服器真正啟動時呼叫一次；`npm run build` 不會執行到這裡
 * （`instrumentation.ts` 那邊已擋掉建置階段），避免建置過程卡在等待
 * 資料庫連線或無限輪詢。
 */

let started = false;

/**
 * 啟動背景佇列。重複呼叫是安全的。
 *
 * 分析佇列與寄信佇列各自獨立輪詢，互不阻塞：一封信寄很久（SMTP 逾時、
 * 附件很大）不能拖住合約分析，反之亦然。
 */
export function startWorker(): void {
  if (started) {
    return;
  }
  started = true;
  startQueue();
  startEmailQueue();
  console.info('[worker] 背景分析佇列與寄信佇列已啟動');
}

/** 停止兩個佇列，等待進行中的工作結束才回傳，供優雅關機使用。 */
export async function stopWorker(): Promise<void> {
  if (!started) {
    return;
  }
  started = false;
  await Promise.all([stopQueue(), stopEmailQueue()]);
  console.info('[worker] 背景分析佇列與寄信佇列已停止');
}
