/**
 * Drizzle ORM 資料表定義。
 *
 * 對應設計文件《交友合約檢核工具：系統設計文件》第五章「資料模型」。
 * 列舉欄位的值必須與 `src/lib/types.ts` 的字面量型別完全一致，
 * 修改前請同步確認兩邊。
 *
 * 主鍵一律使用 uuid（`defaultRandom()`）；設計文件中沒有標出主鍵的表
 * （例如 `settings`、`ip_windows`）也一律補上 uuid 的 `id` 欄位，
 * 原文列出的欄位則全數保留，不省略。
 */

import {
  boolean,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { AnalysisResult } from '@/lib/types';

/** 時間戳共用欄位：一律 timestamp with time zone，預設 now()。 */
function timestampTz(column: string) {
  return timestamp(column, { withTimezone: true });
}

// ---------------------------------------------------------------------------
// 列舉。值必須與 src/lib/types.ts 的字面量型別完全一致。
// ---------------------------------------------------------------------------

/** 對應 AnalysisMode。 */
export const analysisModeEnum = pgEnum('analysis_mode', ['merged', 'separate']);

/** 對應 AnalysisStatus。 */
export const analysisStatusEnum = pgEnum('analysis_status', [
  'queued',
  'running',
  'done',
  'failed',
]);

/** 對應 DocumentKind。 */
export const documentKindEnum = pgEnum('document_kind', [
  'checklist',
  'regulation',
  'privacy',
  'terms',
]);

/** 對應 IpStatus。 */
// 型別名稱刻意不叫 ip_status：PostgreSQL 建立資料表時會自動產生一個同名的
// 複合型別，而下面有一張資料表就叫 ip_status，兩者會撞名導致遷移失敗。
export const ipStatusEnum = pgEnum('ip_state', ['normal', 'suspended', 'blocked']);

/** 對應 ReportCategory。 */
export const reportCategoryEnum = pgEnum('report_category', [
  'wrong_result',
  'upload_failed',
  'regulation_error',
  'other',
]);

/** 對應 ReportStatus。 */
export const reportStatusEnum = pgEnum('report_status', ['open', 'replied', 'closed']);

/** 對應 ExtractMethod。 */
export const extractMethodEnum = pgEnum('extract_method', ['text', 'ocr']);

/** 封鎖清單的類型：IP 單一位址、CIDR 網段、信箱。 */
export const blocklistTypeEnum = pgEnum('blocklist_type', ['ip', 'cidr', 'email']);

/** 每日次數計數的主體類型：瀏覽器識別碼或 IP。 */
export const dailyQuotaSubjectTypeEnum = pgEnum('daily_quota_subject_type', [
  'client',
  'ip',
]);

/** 對應 SettingKey。 */
export const settingKeyEnum = pgEnum('setting_key', [
  'ai',
  'analysis_hook',
  'abuse_rules',
  'retention',
  'smtp',
]);

/**
 * 對應 ChainErrorCategory（見 `src/lib/ai/chain.ts`）。
 *
 * 型別名稱刻意不叫 ai_chain_attempts（下面資料表的名字）：同樣是為了
 * 避開「pgEnum 名稱撞資料表隱含複合型別」的坑，這裡索性連「像」都不要像，
 * 用完全不同的字根命名。
 */
export const chainErrorCategoryEnum = pgEnum('chain_error_category', [
  'unreachable',
  'rate_limit',
  'timeout',
  'server_error',
  'bad_request',
  'parse_error',
]);

/** 寄信佇列的信件類型。 */
export const emailJobTypeEnum = pgEnum('email_job_type', ['analysis_hook', 'report_reply']);

/** 寄信佇列的處理狀態。 */
export const emailJobStatusEnum = pgEnum('email_job_status', [
  'queued',
  'sending',
  'sent',
  'failed',
]);

// ---------------------------------------------------------------------------
// clients：瀏覽器識別碼
// ---------------------------------------------------------------------------

export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  firstSeen: timestampTz('first_seen').defaultNow().notNull(),
  lastSeen: timestampTz('last_seen').defaultNow().notNull(),
  firstIp: inet('first_ip').notNull(),
  userAgent: text('user_agent'),
  /** 兩碼國別代碼，來自 Cloudflare 的 CF-IPCountry 標頭。未知時為 null。 */
  country: text('country'),
});

// ---------------------------------------------------------------------------
// ip_windows：滑動視窗計數
// ---------------------------------------------------------------------------

export const ipWindows = pgTable(
  'ip_windows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ip: inet('ip').notNull(),
    /** 該筆計數所屬的分鐘桶（分鐘整點）。 */
    bucketMinute: timestampTz('bucket_minute').notNull(),
    uploadCount: integer('upload_count').default(0).notNull(),
    analyzeCount: integer('analyze_count').default(0).notNull(),
    rejectedCount: integer('rejected_count').default(0).notNull(),
  },
  (table) => [
    uniqueIndex('ip_windows_ip_bucket_minute_idx').on(table.ip, table.bucketMinute),
  ],
);

// ---------------------------------------------------------------------------
// ip_status：IP 狀態（正常、暫停中、已封鎖）
// ---------------------------------------------------------------------------

export const ipStatus = pgTable(
  'ip_status',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ip: inet('ip').notNull(),
    status: ipStatusEnum('status').default('normal').notNull(),
    suspendedUntil: timestampTz('suspended_until'),
    reason: text('reason'),
    /** 24 小時內被暫停的次數，達 R4 閾值即自動封鎖。 */
    suspendCount24h: integer('suspend_count_24h').default(0).notNull(),
    /**
     * 累計上傳非交友媒合服務契約的次數（2026-09-05 需求）。與上面的
     * `suspendCount24h`（R1 至 R4 專用）各自獨立，互不歸零、互不影響，
     * 見 `src/lib/guard/off-topic.ts`。
     */
    offTopicCount: integer('off_topic_count').default(0).notNull(),
    updatedAt: timestampTz('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('ip_status_ip_idx').on(table.ip)],
);

// ---------------------------------------------------------------------------
// daily_quota：每日次數
// ---------------------------------------------------------------------------

export const dailyQuota = pgTable(
  'daily_quota',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subjectType: dailyQuotaSubjectTypeEnum('subject_type').notNull(),
    /** client 時為 clients.id 的字串；ip 時為 IP 位址字串。 */
    subject: text('subject').notNull(),
    day: date('day').notNull(),
    usedCount: integer('used_count').default(0).notNull(),
  },
  (table) => [
    uniqueIndex('daily_quota_subject_day_idx').on(
      table.subjectType,
      table.subject,
      table.day,
    ),
  ],
);

// ---------------------------------------------------------------------------
// documents：法規文件版本（查核表、公告全文）
// ---------------------------------------------------------------------------

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: documentKindEnum('kind').notNull(),
    version: integer('version').notNull(),
    markdown: text('markdown').notNull(),
    /** 官方原檔（PDF 或 DOCX）的儲存路徑，選填。 */
    attachmentPath: text('attachment_path'),
    /**
     * 官方發布頁的網址，前台顯示為外部連結（2026-09-04 User 裁決：
     * 檔案下載改由官方網站提供，本站不供檔）。
     */
    sourceUrl: text('source_url'),
    /** 官方來源的顯示名稱，例如「內政部公告頁」、「臺中市政府法制局」。 */
    sourceLabel: text('source_label'),
    isPublished: boolean('is_published').default(false).notNull(),
    publishedAt: timestampTz('published_at'),
    note: text('note'),
    createdAt: timestampTz('created_at').defaultNow().notNull(),
  },
  (table) => [index('documents_kind_published_idx').on(table.kind, table.isPublished)],
);

// ---------------------------------------------------------------------------
// analyses：分析主檔
// ---------------------------------------------------------------------------

export const analyses = pgTable(
  'analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    ip: inet('ip').notNull(),
    /** 兩碼國別代碼，來自 Cloudflare 的 CF-IPCountry 標頭。 */
    country: text('country'),
    /**
     * IPv6 來源對應的 IPv4 表示法。
     *
     * 只有在 Cloudflare 啟用「Pseudo IPv4」時才會有值，且那是由 IPv6
     * 推導出來的合成位址（240.0.0.0/4 區段），**不是使用者真正的 IPv4**。
     * 純 IPv6 的連線本來就沒有對應的真實 IPv4，這一點無法用任何方式取得。
     * 存它的用途是給只吃 IPv4 格式的工具比對，不可當成真實位址使用。
     */
    pseudoIpv4: inet('pseudo_ipv4'),
    mode: analysisModeEnum('mode').notNull(),
    status: analysisStatusEnum('status').default('queued').notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** 估算費用，單位美元，保留六位小數。 */
    costEstimate: numeric('cost_estimate', { precision: 12, scale: 6 }),
    /** AI 回傳的完整檢核結果，結構見 AnalysisResult。 */
    resultJson: jsonb('result_json').$type<AnalysisResult>(),
    /**
     * 分析失敗時給使用者看的中文說明。
     *
     * 有獨立欄位的理由：失敗訊息與分析結果是兩種不同的東西，混在
     * `result_json` 裡會讓「有結果但結果為空」和「根本沒有結果」分不出來，
     * 後台查問題時也無法直接依失敗原因篩選。
     */
    errorMessage: text('error_message'),
    /** 這筆分析當時依據的查核表版本。 */
    checklistVersionId: uuid('checklist_version_id').references(() => documents.id),
    /** 這筆分析當時依據的公告全文版本。 */
    regulationVersionId: uuid('regulation_version_id').references(() => documents.id),
    createdAt: timestampTz('created_at').defaultNow().notNull(),
    finishedAt: timestampTz('finished_at'),
  },
  (table) => [
    index('analyses_client_created_idx').on(table.clientId, table.createdAt.desc()),
    index('analyses_status_idx').on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// analysis_files：分析所附的檔案
// ---------------------------------------------------------------------------

export const analysisFiles = pgTable('analysis_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  analysisId: uuid('analysis_id')
    .notNull()
    .references(() => analyses.id),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  /** 位元組數。 */
  size: integer('size').notNull(),
  storagePath: text('storage_path'),
  extractMethod: extractMethodEnum('extract_method'),
  extractedText: text('extracted_text'),
  pageCount: integer('page_count'),
  /** 原始檔保留期滿後刪除，此欄記錄刪除時間；未刪除為 null。 */
  deletedAt: timestampTz('deleted_at'),
});

// ---------------------------------------------------------------------------
// reports：問題回報
// ---------------------------------------------------------------------------

export const reports = pgTable('reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').references(() => clients.id),
  ip: inet('ip').notNull(),
  category: reportCategoryEnum('category').notNull(),
  message: text('message').notNull(),
  contactEmail: text('contact_email'),
  screenshotPath: text('screenshot_path'),
  analysisId: uuid('analysis_id').references(() => analyses.id),
  status: reportStatusEnum('status').default('open').notNull(),
  createdAt: timestampTz('created_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// report_replies：回報回覆
// ---------------------------------------------------------------------------

export const reportReplies = pgTable('report_replies', {
  id: uuid('id').defaultRandom().primaryKey(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => reports.id),
  body: text('body').notNull(),
  sentEmail: boolean('sent_email').default(false).notNull(),
  createdAt: timestampTz('created_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// blocklist：封鎖清單
// ---------------------------------------------------------------------------

export const blocklist = pgTable(
  'blocklist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: blocklistTypeEnum('type').notNull(),
    /** IP 位址、CIDR 網段字串，或信箱。 */
    value: text('value').notNull(),
    reason: text('reason'),
    createdAt: timestampTz('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('blocklist_type_value_idx').on(table.type, table.value)],
);

// ---------------------------------------------------------------------------
// settings：系統設定
// ---------------------------------------------------------------------------

export const settings = pgTable(
  'settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: settingKeyEnum('key').notNull(),
    valueJson: jsonb('value_json').notNull(),
    updatedAt: timestampTz('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('settings_key_idx').on(table.key)],
);

// ---------------------------------------------------------------------------
// email_jobs：寄信佇列
// ---------------------------------------------------------------------------

export const emailJobs = pgTable('email_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: emailJobTypeEnum('type').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  status: emailJobStatusEnum('status').default('queued').notNull(),
  lastError: text('last_error'),
  createdAt: timestampTz('created_at').defaultNow().notNull(),
  updatedAt: timestampTz('updated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// ai_chain_attempts：AI 備援鏈的每一次嘗試
// ---------------------------------------------------------------------------

/**
 * 記錄 `analyzeContract`（`src/lib/ai/analyze.ts`）依備援鏈嘗試呼叫 AI 的
 * 每一次結果，供後台「備援鏈狀態」表格算近 30 天完成／失敗數與最後事件。
 *
 * 只記錄「實際發出的嘗試」：因跳層規則（同上游／同憑證）或熔斷而被略過的
 * 層不算一次嘗試，不會有紀錄——這是刻意的，紀錄的意義是「這一層被實際
 * 使用時表現如何」，被跳過代表這次分析根本沒碰到它。
 */
export const aiChainAttempts = pgTable(
  'ai_chain_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** 對應 ChainLayerId，例如 groq_direct、gateway_primary、gateway_fallback。 */
    layerId: text('layer_id').notNull(),
    ok: boolean('ok').notNull(),
    /** 失敗時的分類；成功時為 null。 */
    errorCategory: chainErrorCategoryEnum('error_category'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestampTz('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('ai_chain_attempts_layer_created_idx').on(table.layerId, table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// admin_audit：管理員操作紀錄
// ---------------------------------------------------------------------------

export const adminAudit = pgTable('admin_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  adminEmail: text('admin_email').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  createdAt: timestampTz('created_at').defaultNow().notNull(),
});
