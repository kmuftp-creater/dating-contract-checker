import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 法規文件的 markdown 渲染元件。
 *
 * 兩份法規（查核表、公告全文）都以表格為主，而查核表的「查核項目說明」
 * 欄是整段條文，很長。表格因此必須讓文字換行去適應欄寬，而不是把表格
 * 撐到跟內容一樣寬、逼使用者往右拖（那是先前的做法，實際用起來很糟）。
 *
 * 外層仍保留可橫向捲動的容器，但那只是保險：正常情況下表格會塞進版面，
 * 只有內容真的無法斷行時才會出現捲軸。樣式沿用專案色票（globals.css），
 * 不引入 typography 外掛。
 *
 * 這是一個同步的伺服端元件：react-markdown 本身不需要用戶端狀態，
 * 前台頁與後台編輯頁的即時預覽都可以直接沿用。
 */
export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="max-w-none text-sm leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-6 mb-3 text-xl font-semibold text-ink first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-6 mb-3 text-lg font-semibold text-ink first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 mb-2 text-base font-semibold text-ink">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-3 text-ink">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3 list-disc space-y-1 pl-5 text-ink">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5 text-ink">{children}</ol>
          ),
          li: ({ children }) => <li className="text-ink">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-6 border-hairline" />,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-hairline pl-3 text-ink-muted">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="mb-4 overflow-x-auto rounded-(--radius-control) border border-hairline">
              {/* 不要加 min-w-max：那會讓表格寬度跟著最長的一段文字走，
                  整份查核表就得往右拖才看得完。 */}
              <table className="w-full table-fixed border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-canvas">{children}</thead>,
          tr: ({ children }) => <tr className="border-b border-hairline last:border-0">{children}</tr>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left align-top font-semibold break-words text-ink first:w-16 sm:first:w-20">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 align-top break-words text-ink">{children}</td>
          ),
          code: ({ children }) => (
            <code className="rounded-(--radius-control) bg-canvas px-1 py-0.5 font-mono text-[0.9em] text-ink">
              {children}
            </code>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
