/**
 * 在頁面繪製前套用主題，避免重新整理時先閃一下亮色再跳成暗色。
 *
 * 這段必須是同步執行的行內指令碼，所以用 dangerouslySetInnerHTML，
 * 不能改寫成 useEffect。
 */
const script = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored ? stored === 'dark' : prefersDark;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    // 隱私模式或封鎖儲存空間時讀不到，維持亮色即可。
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
