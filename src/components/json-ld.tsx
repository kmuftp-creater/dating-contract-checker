/**
 * 輸出一段 JSON-LD 結構化資料的 `<script>` 標籤。
 *
 * 做法依 Next.js 16 文件 `01-app/02-guides/json-ld.md` 的建議：直接在
 * 伺服器元件裡輸出原生 `<script type="application/ld+json">`，而不是用
 * `next/script`（那個元件是為了最佳化可執行的 JavaScript 載入時機，
 * JSON-LD 是結構化資料不是要執行的程式碼，用不到那些最佳化）。
 *
 * `JSON.stringify` 不會過濾惡意字串，若資料裡剛好出現 `</script>` 之類
 * 的片段會被瀏覽器提前判斷成標籤結束，造成注入。文件建議把 `<` 換成
 * 其 Unicode 逸出序列 `<`，這裡照做。
 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
