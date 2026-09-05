import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 的設定檔，只供 CLI（`generate`、`migrate`）使用。
 *
 * 這裡刻意直接讀 `process.env.DATABASE_URL`，不透過 `src/lib/env.ts`：
 * `env.ts` 啟動時會要求 `AUTH_SECRET`、`ADMIN_EMAILS` 等一整組執行期
 * 環境變數，但 `drizzle-kit generate` 只需要一個資料庫連線字串（甚至
 * 本機沒有 PostgreSQL 時也只是產生 SQL，不會真的連線），沒必要把
 * CLI 綁死在整組執行期環境變數上。
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/contract_app',
  },
});
