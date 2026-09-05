import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db, schema } from '@/db';
import { getSetting } from '@/lib/settings';

/**
 * 每日次數。
 *
 * 對應設計文件第二章第 3 節：沒有登入，所以用兩把尺同時量
 * （瀏覽器識別碼與 IP），任一把尺達上限即擋；重置時間為每日
 * 00:00 台北時間。上限值一律讀 `abuse_rules` 設定的
 * `dailyAnalysisLimit`，不在這裡寫死數字。
 */

/** 計數的主體：瀏覽器識別碼（client）或 IP。 */
export interface QuotaSubject {
  type: 'client' | 'ip';
  value: string;
}

/** 單一把尺目前的次數狀態。 */
export interface SubjectQuotaState {
  type: 'client' | 'ip';
  value: string;
  /** 當日上限。 */
  limit: number;
  /** 當日已用次數。 */
  usedCount: number;
  /** 當日剩餘次數，不會小於 0。 */
  remaining: number;
}

export interface ConsumeQuotaResult {
  allowed: boolean;
  /** 每把尺的次數狀態；被擋下時是「未扣之前」的狀態。 */
  subjects: SubjectQuotaState[];
  /** 被擋下時，指出是哪一把尺超過上限。 */
  blockedBy?: SubjectQuotaState;
}

/**
 * 把時間戳換算成台北時區的日期字串（`YYYY-MM-DD`）。
 *
 * 刻意不依賴行程的 `TZ` 環境變數，改用 `Intl` 明確指定時區換算，
 * 這樣即使執行環境的 `TZ` 設定被忽略或跑在別的時區也不會算錯日界。
 */
export function taipeiDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA 的格式固定為 YYYY-MM-DD，剛好對應 PostgreSQL date 欄位的字串格式。
  return formatter.format(date);
}

/** 為排序後的計數主體排出穩定的鎖定順序，避免不同呼叫互相鎖定造成死結。 */
function sortSubjects(subjects: QuotaSubject[]): QuotaSubject[] {
  return [...subjects].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type < b.type ? -1 : 1;
    }
    return a.value < b.value ? -1 : 1;
  });
}

function subjectKey(subject: QuotaSubject): string {
  return `${subject.type}:${subject.value}`;
}

/**
 * 先檢查再一起扣：任何一把尺會超過上限，整批都不扣；全部通過才一起加。
 * 整段包在一個交易裡，並用 `SELECT ... FOR UPDATE` 鎖列，避免併發下
 * 兩個請求各自讀到「還沒扣」的舊值，一起通過檢查後才各自扣，導致
 * 實際扣掉的次數超過上限。
 */
export async function consumeQuota(
  subjects: QuotaSubject[],
  count: number,
): Promise<ConsumeQuotaResult> {
  const rules = await getSetting('abuse_rules');
  const limit = rules.dailyAnalysisLimit;
  const day = taipeiDateString();
  const ordered = sortSubjects(subjects);

  return db.transaction(async (tx) => {
    const stateByKey = new Map<string, SubjectQuotaState>();

    for (const subject of ordered) {
      // 先確保今天有一列可鎖定，不存在就建立為 0；已存在則不動它。
      await tx
        .insert(schema.dailyQuota)
        .values({ subjectType: subject.type, subject: subject.value, day, usedCount: 0 })
        .onConflictDoNothing({
          target: [
            schema.dailyQuota.subjectType,
            schema.dailyQuota.subject,
            schema.dailyQuota.day,
          ],
        });

      const rows = await tx
        .select({ usedCount: schema.dailyQuota.usedCount })
        .from(schema.dailyQuota)
        .where(
          and(
            eq(schema.dailyQuota.subjectType, subject.type),
            eq(schema.dailyQuota.subject, subject.value),
            eq(schema.dailyQuota.day, day),
          ),
        )
        .for('update')
        .limit(1);

      const usedCount = rows[0]?.usedCount ?? 0;
      stateByKey.set(subjectKey(subject), {
        type: subject.type,
        value: subject.value,
        limit,
        usedCount,
        remaining: Math.max(limit - usedCount, 0),
      });
    }

    const beforeStates = subjects.map((subject) => {
      const state = stateByKey.get(subjectKey(subject));
      if (!state) {
        throw new Error(`內部錯誤：找不到主體 ${subjectKey(subject)} 的次數狀態。`);
      }
      return state;
    });

    const blockedBy = beforeStates.find((state) => state.usedCount + count > state.limit);
    if (blockedBy) {
      return { allowed: false, subjects: beforeStates, blockedBy };
    }

    for (const subject of ordered) {
      await tx
        .update(schema.dailyQuota)
        .set({ usedCount: sql`${schema.dailyQuota.usedCount} + ${count}` })
        .where(
          and(
            eq(schema.dailyQuota.subjectType, subject.type),
            eq(schema.dailyQuota.subject, subject.value),
            eq(schema.dailyQuota.day, day),
          ),
        );
    }

    const afterStates: SubjectQuotaState[] = beforeStates.map((state) => ({
      ...state,
      usedCount: state.usedCount + count,
      remaining: Math.max(limit - (state.usedCount + count), 0),
    }));

    return { allowed: true, subjects: afterStates };
  });
}

/** 回傳兩把尺各自的已用與剩餘次數，不扣次數也不鎖列。 */
export async function getRemaining(subjects: QuotaSubject[]): Promise<SubjectQuotaState[]> {
  const rules = await getSetting('abuse_rules');
  const limit = rules.dailyAnalysisLimit;
  const day = taipeiDateString();

  const results: SubjectQuotaState[] = [];
  for (const subject of subjects) {
    const rows = await db
      .select({ usedCount: schema.dailyQuota.usedCount })
      .from(schema.dailyQuota)
      .where(
        and(
          eq(schema.dailyQuota.subjectType, subject.type),
          eq(schema.dailyQuota.subject, subject.value),
          eq(schema.dailyQuota.day, day),
        ),
      )
      .limit(1);

    const usedCount = rows[0]?.usedCount ?? 0;
    results.push({
      type: subject.type,
      value: subject.value,
      limit,
      usedCount,
      remaining: Math.max(limit - usedCount, 0),
    });
  }
  return results;
}

/**
 * 退還次數（分析失敗時不應扣次數，見設計文件第二章第 4 節）。
 * 退還後的已用次數不會小於 0。
 */
export async function refundQuota(subjects: QuotaSubject[], count: number): Promise<void> {
  const day = taipeiDateString();
  const ordered = sortSubjects(subjects);

  await db.transaction(async (tx) => {
    for (const subject of ordered) {
      // 先確保今天有一列可更新，不存在就建立為 0；已存在則不動它。
      await tx
        .insert(schema.dailyQuota)
        .values({ subjectType: subject.type, subject: subject.value, day, usedCount: 0 })
        .onConflictDoNothing({
          target: [
            schema.dailyQuota.subjectType,
            schema.dailyQuota.subject,
            schema.dailyQuota.day,
          ],
        });

      await tx
        .update(schema.dailyQuota)
        .set({ usedCount: sql`greatest(${schema.dailyQuota.usedCount} - ${count}, 0)` })
        .where(
          and(
            eq(schema.dailyQuota.subjectType, subject.type),
            eq(schema.dailyQuota.subject, subject.value),
            eq(schema.dailyQuota.day, day),
          ),
        );
    }
  });
}
