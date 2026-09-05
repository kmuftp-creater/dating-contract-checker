/**
 * 來源位址的顯示。
 *
 * 兩件事：照實顯示使用者實際連進來的位址，並標明它是 IPv4 還是 IPv6。
 *
 * 為什麼要標版本：現在許多家用寬頻預設走 IPv6，管理員看到一長串十六進位
 * 會以為系統壞了。標一個小徽章就不必再懷疑。
 *
 * 為什麼不「換算成 IPv4」：純 IPv6 的連線本來就沒有對應的真實 IPv4，
 * 任何服務都變不出來。硬要生一個只會得到虛構的位址，拿去比對或封鎖都是錯的。
 */

/** PostgreSQL 的 inet 欄位讀出來會帶遮罩後綴（例如 /32、/128），顯示時去掉。 */
function stripMask(value: string): string {
  const slash = value.indexOf('/');
  return slash > 0 ? value.slice(0, slash) : value;
}

/**
 * 判斷位址版本。
 *
 * 判準是「有沒有冒號」：IPv6 一定有，IPv4 一定沒有。
 * `::ffff:1.2.3.4` 這種 IPv4 映射位址在寫進資料庫前已由
 * `normalizeIp()` 還原成純 IPv4，這裡不會遇到。
 */
export function ipVersion(value: string): 'IPv4' | 'IPv6' {
  return stripMask(value).includes(':') ? 'IPv6' : 'IPv4';
}

export function IpAddress({
  value,
  country,
  className = '',
}: {
  value: string;
  /** 兩碼國別代碼，例如 TW。沒有時不顯示。 */
  country?: string | null;
  className?: string;
}) {
  const address = stripMask(value);
  const version = ipVersion(address);

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="font-mono text-xs break-all">{address}</span>
      <span className="rounded-(--radius-control) border border-hairline px-1 py-0.5 text-[0.6875rem] leading-none text-ink-muted">
        {version}
      </span>
      {country && (
        <span className="rounded-(--radius-control) border border-hairline px-1 py-0.5 text-[0.6875rem] leading-none text-ink-muted">
          {country}
        </span>
      )}
    </span>
  );
}
