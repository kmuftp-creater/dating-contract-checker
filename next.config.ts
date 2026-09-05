import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 產出獨立執行包，容器映像檔不必帶整個 node_modules。
  output: 'standalone',

  // sharp、@napi-rs/canvas、pdfjs-dist 都含原生模組或需要 Node 執行環境，
  // 不能被打包進伺服器組件的產物，交給 Node 直接載入。
  serverExternalPackages: [
    'sharp',
    '@napi-rs/canvas',
    'pdfjs-dist',
    'heic-convert',
    'mammoth',
    'xlsx',
    'pg',
    'nodemailer',
  ],

  /**
   * 把 pdfjs-dist 的執行期資源一併帶進獨立輸出包。
   *
   * 為什麼需要手動指定：這三份資源不是用 import 載入的，而是在執行時才
   * 用 `require.resolve` 組出路徑去讀檔。Next.js 的檔案追蹤是靜態分析
   * import 關係，看不到這種寫法，於是它們不會被複製進 `.next/standalone`。
   *
   * 症狀特別容易漏掉：開發模式與 `npm run build` 都不會報錯，本機測試
   * 因為讀得到 node_modules 也一切正常，只有部署到容器（Dockerfile 只
   * 複製 standalone 目錄）之後，PDF 的文字抽取才會 100% 失敗。
   */
  outputFileTracingIncludes: {
    // 兩條路徑都會抽 PDF：前台上傳、後台的 PDF 匯入草稿。
    '/api/files': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/cmaps/**',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
    '/admin/documents/import': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/cmaps/**',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
  },

  /**
   * 明確排除不該進部署包的東西。
   *
   * 追蹤機制寧可多帶也不願漏帶，判斷不確定時會把整個專案掃進來。
   * `data/` 底下是使用者上傳的合約，被打進映像檔等於把別人的資料
   * 帶著到處跑；`scripts/` 是驗證腳本、`docs/` 與 `seed/` 是文件與初始
   * 資料，正式執行都用不到。
   */
  outputFileTracingExcludes: {
    '**': [
      './data/**',
      './scripts/**',
      './docs/**',
      './.next/cache/**',
    ],
  },

  experimental: {
    serverActions: {
      // 上傳走的是路由處理常式而非伺服器動作，這裡只放寬表單類操作。
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
