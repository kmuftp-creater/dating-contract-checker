import 'server-only';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '@/lib/env';

import * as schema from './schema';

/**
 * 全域連線池。
 *
 * Next.js 開發模式下模組會因熱重載重複載入，這裡把 pool 掛在
 * globalThis 上避免每次重載都新開一個連線池，耗盡資料庫連線數。
 */
const globalForDb = globalThis as unknown as {
  __contractAppPool?: Pool;
};

function createPool(): Pool {
  return new Pool({
    connectionString: env.databaseUrl,
  });
}

export const pool = globalForDb.__contractAppPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__contractAppPool = pool;
}

/** Drizzle 資料庫實例，供各模組匯入使用。 */
export const db = drizzle(pool, { schema });

export { schema };
