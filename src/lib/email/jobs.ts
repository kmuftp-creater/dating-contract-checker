import 'server-only';

import { eq } from 'drizzle-orm';

import { db, schema } from '@/db';

import { EXTRA_EMAIL_HANDLERS } from './hooks';
import { buildFromHeader, errorMessage, type EmailJobRow } from './common';
import { buildReplyEmail } from './templates';
import { getTransport } from './transport';

/**
 * 寄信佇列的建立與處理。
 *
 * `email_jobs` 表本身就是佇列，做法與 `src/lib/analyses.ts` 的
 * `claimNext`（分析佇列）相同套路：`SELECT ... FOR UPDATE SKIP LOCKED`
 * 取件，取到的工作先轉成 `sending`，處理完再轉成 `sent` 或（重試次數未達
 * 上限時）退回 `queued` 等下一輪重試，超過上限才轉成永久失敗的 `failed`。
 *
 * 這支輪詢與 `src/lib/worker/queue.ts` 的分析佇列輪詢完全分開（各自的
 * `setInterval`），理由見設計文件需求 E：一封信寄很久不能卡住分析。
 *
 * 這個檔案只實作核心的一種信：問題回報的回覆通知。其他種類的信由
 * `./hooks.ts` 的擴充點掛上來，核心不需要知道掛了什麼。
 */

/** `report_reply` 類型工作的內容。 */
interface ReportReplyJobPayload {
  reportId: string;
  replyId: string;
}

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 建立工作
// ---------------------------------------------------------------------------

/**
 * 建立一筆問題回報回覆通知工作。
 *
 * 收件人是使用者自己在問題回報表單留下的信箱，寄件走的是部署者自己填的
 * SMTP，因此兩種 EDITION 都可用，不受公開版的資料流限制。
 */
export async function enqueueReply(reportId: string, replyId: string): Promise<void> {
  const payload: ReportReplyJobPayload = { reportId, replyId };
  await db.insert(schema.emailJobs).values({
    type: 'report_reply',
    payloadJson: payload,
  });
}

// ---------------------------------------------------------------------------
// 處理工作
// ---------------------------------------------------------------------------

/**
 * 處理一筆 `report_reply` 工作：找不到聯絡信箱就視為完成、不寄信
 * （見設計文件第二章第 7 節：「若有留信箱」才寄）；寄出成功後回填
 * `report_replies.sent_email`。
 */
async function handleReportReplyJob(job: EmailJobRow): Promise<void> {
  const payload = job.payloadJson as ReportReplyJobPayload;

  const [report] = await db
    .select()
    .from(schema.reports)
    .where(eq(schema.reports.id, payload.reportId))
    .limit(1);
  if (!report) {
    throw new Error(`找不到問題回報 id 為 ${payload.reportId} 的紀錄，可能已被刪除。`);
  }

  const [reply] = await db
    .select()
    .from(schema.reportReplies)
    .where(eq(schema.reportReplies.id, payload.replyId))
    .limit(1);
  if (!reply) {
    throw new Error(`找不到回覆 id 為 ${payload.replyId} 的紀錄，可能已被刪除。`);
  }

  if (!report.contactEmail) {
    return;
  }

  const email = buildReplyEmail({
    reportId: report.id,
    category: report.category,
    message: report.message,
    replyBody: reply.body,
    createdAt: reply.createdAt,
  });

  const transporter = await getTransport();
  await transporter.sendMail({
    from: await buildFromHeader(),
    to: report.contactEmail,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });

  await db
    .update(schema.reportReplies)
    .set({ sentEmail: true })
    .where(eq(schema.reportReplies.id, reply.id));
}

/** 用 `SKIP LOCKED` 取一筆待處理工作並轉成 `sending`，取不到回傳 null。 */
async function claimNextEmailJob(): Promise<EmailJobRow | null> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: schema.emailJobs.id })
      .from(schema.emailJobs)
      .where(eq(schema.emailJobs.status, 'queued'))
      .orderBy(schema.emailJobs.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });

    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }

    const [updated] = await tx
      .update(schema.emailJobs)
      .set({ status: 'sending', updatedAt: new Date() })
      .where(eq(schema.emailJobs.id, candidate.id))
      .returning();

    return updated ?? null;
  });
}

async function markJobSent(id: string): Promise<void> {
  await db
    .update(schema.emailJobs)
    .set({ status: 'sent', lastError: null, updatedAt: new Date() })
    .where(eq(schema.emailJobs.id, id));
}

/** 累加重試次數；達上限（含）就轉成永久失敗，否則退回 `queued` 等下一輪。 */
async function markJobFailed(id: string, previousAttempts: number, error: unknown): Promise<void> {
  const attempts = previousAttempts + 1;
  const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'queued';
  await db
    .update(schema.emailJobs)
    .set({ attempts, status, lastError: errorMessage(error), updatedAt: new Date() })
    .where(eq(schema.emailJobs.id, id));
}

/**
 * 取一筆待處理工作並處理，依 `type` 分派。沒有可取的工作時回傳 false，
 * 呼叫端（輪詢迴圈）依此判斷這一輪是否已把佇列清空。
 */
export async function processNextEmailJob(): Promise<boolean> {
  const claimed = await claimNextEmailJob();
  if (!claimed) {
    return false;
  }

  try {
    if (claimed.type === 'report_reply') {
      await handleReportReplyJob(claimed);
    } else {
      // 核心不認得的類型交給擴充點（見 `./hooks.ts`）。找不到處理器時
      // 讓這筆工作明確失敗，而不是安靜地標記成已寄出。
      const handler = EXTRA_EMAIL_HANDLERS[claimed.type];
      if (!handler) {
        throw new Error(`沒有可處理「${claimed.type}」類型寄信工作的處理器。`);
      }
      await handler(claimed);
    }
    await markJobSent(claimed.id);
  } catch (error) {
    console.error(`[email-worker] 處理寄信工作 ${claimed.id}（${claimed.type}）失敗：${errorMessage(error)}`);
    await markJobFailed(claimed.id, claimed.attempts, error);
  }

  return true;
}

// ---------------------------------------------------------------------------
// 輪詢：與分析佇列（src/lib/worker/queue.ts）分開的獨立計時器
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;
let processing = false;
let stopping = false;

/** 一輪輪詢：把目前佇列裡待處理的工作盡量處理完，不要每輪只寄一封。 */
async function tick(): Promise<void> {
  if (stopping || processing) {
    return;
  }
  processing = true;
  try {
    let more = true;
    while (!stopping && more) {
      more = await processNextEmailJob();
    }
  } catch (error) {
    console.error(`[email-worker] 輪詢時發生未預期錯誤：${errorMessage(error)}`);
  } finally {
    processing = false;
  }
}

/** 啟動寄信佇列輪詢。重複呼叫是安全的，已啟動時不會重複建立計時器。 */
export function startEmailQueue(): void {
  if (timer) {
    return;
  }
  stopping = false;
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  void tick();
}

/** 停止寄信佇列輪詢並等待進行中的批次結束，供優雅關機使用。 */
export async function stopEmailQueue(): Promise<void> {
  stopping = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  while (processing) {
    await sleep(100);
  }
}
