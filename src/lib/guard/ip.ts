import 'server-only';

import { BlockList, isIP } from 'node:net';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from '@/db';

/**
 * IP 正規化與封鎖比對。
 *
 * 對應設計文件第三章第 6 節「封鎖管理」：封鎖 IP 支援單一位址與 CIDR
 * 網段，被封鎖的來源打任何前台 API 都應回 403。
 */

/**
 * 把使用者來源字串正規化成單純的 IP 位址：
 * - 去除埠號（`1.2.3.4:1234`、`[::1]:8080`）。
 * - 把 IPv4 映射的 IPv6 位址（`::ffff:1.2.3.4`）還原成純 IPv4。
 * - 無法辨識為合法 IP 時回傳 null。
 */
export function normalizeIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  let candidate = trimmed;

  if (candidate.startsWith('[')) {
    // `[IPv6]` 或 `[IPv6]:port` 形式，方括號內才是位址本體。
    const closeIndex = candidate.indexOf(']');
    if (closeIndex === -1) {
      return null;
    }
    candidate = candidate.slice(1, closeIndex);
  } else {
    // 只有「剛好一個冒號、且冒號前是合法 IPv4」時才視為 ipv4:port，
    // 避免誤把沒有方括號的裸 IPv6 位址（多個冒號）當成有埠號。
    const firstColon = candidate.indexOf(':');
    const lastColon = candidate.lastIndexOf(':');
    if (firstColon !== -1 && firstColon === lastColon) {
      const maybeIp = candidate.slice(0, firstColon);
      if (isIP(maybeIp) === 4) {
        candidate = maybeIp;
      }
    }
  }

  const version = isIP(candidate);
  if (version === 0) {
    return null;
  }

  if (version === 6) {
    // IPv4 映射的 IPv6 位址（RFC 4291 第 2.5.5.2 節），還原成純 IPv4
    // 表示法，避免同一來源因位址寫法不同而繞過封鎖或計數。
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(candidate);
    if (mapped && isIP(mapped[1]) === 4) {
      return mapped[1];
    }
    return candidate.toLowerCase();
  }

  return candidate;
}

/** 判斷位址的協定族，供 `net.BlockList` 使用。 */
function ipFamily(ip: string): 'ipv4' | 'ipv6' | null {
  const version = isIP(ip);
  if (version === 4) return 'ipv4';
  if (version === 6) return 'ipv6';
  return null;
}

/**
 * 比對 `blocklist` 表中 type 為 `ip` 與 `cidr` 的項目。
 *
 * 用 Node 內建的 `net.BlockList` 實作真正的網段比對（不是字串前綴比對），
 * IPv4 與 IPv6 都支援。無法辨識的來源一律視為「未封鎖」，交由呼叫端
 * 另行處理（例如視為無效請求拒絕）。
 */
export async function isBlocked(ip: string): Promise<boolean> {
  const normalized = normalizeIp(ip);
  if (normalized === null) {
    return false;
  }
  const family = ipFamily(normalized);
  if (family === null) {
    return false;
  }

  const rows = await db
    .select({ type: schema.blocklist.type, value: schema.blocklist.value })
    .from(schema.blocklist)
    .where(inArray(schema.blocklist.type, ['ip', 'cidr']));

  const blockList = new BlockList();
  let hasEntry = false;

  for (const row of rows) {
    try {
      if (row.type === 'ip') {
        const entryFamily = ipFamily(row.value);
        if (entryFamily === null) continue;
        blockList.addAddress(row.value, entryFamily);
        hasEntry = true;
      } else {
        const [addr, prefixRaw] = row.value.split('/');
        const prefix = Number(prefixRaw);
        const entryFamily = ipFamily(addr);
        if (entryFamily === null || !Number.isInteger(prefix)) continue;
        blockList.addSubnet(addr, prefix, entryFamily);
        hasEntry = true;
      }
    } catch {
      // 資料庫內容格式不正確時略過該筆，不讓單筆髒資料讓整個檢查失敗。
      continue;
    }
  }

  if (!hasEntry) {
    return false;
  }

  return blockList.check(normalized, family);
}

/** 比對 `blocklist` 表中 type 為 `email` 的項目，大小寫不敏感。 */
export async function isEmailBlocked(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.blocklist.id })
    .from(schema.blocklist)
    .where(
      and(
        eq(schema.blocklist.type, 'email'),
        sql`lower(${schema.blocklist.value}) = lower(${email})`,
      ),
    )
    .limit(1);

  return rows.length > 0;
}
