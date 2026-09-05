# 交友合約檢核工具的容器映像檔。
# PDF 與圖片處理全部走 JavaScript 套件（pdfjs-dist、@napi-rs/canvas、sharp），
# 不需要 poppler 之類的系統執行檔，所以基底映像檔保持精簡。

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 原生模組（sharp、@napi-rs/canvas）會在這一步取得對應 Linux 的預先編譯檔。
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 建置階段的佔位設定。
#
# Next.js 在建置時會載入路由模組以收集設定，而 src/lib/env.ts 對缺少必要
# 環境變數會直接拋錯，於是沒有這幾行就建置不起來。用假值即可：建置過程
# 不連資料庫、不簽發權杖，這些值不會離開建置階段，執行階段由 env_file
# 提供真正的設定並在啟動時重新驗證（見 src/instrumentation.ts）。
#
# 這樣做的另一個好處是「建置映像檔不需要任何正式憑證」，交給別人自行
# 建置公開版時不必先給他一組秘密。
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
ENV APP_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
ENV AUTH_SECRET=build-only-not-used-at-runtime
ENV ADMIN_EMAILS=build@example.com

# 頁尾的著作標示。
#
# 這兩個是 NEXT_PUBLIC_ 變數，**在建置時就被內嵌進前端程式碼**，執行階段
# 的 env_file 改不動它們。所以要用建置參數傳進來，不能只寫在 .env。
# 兩者留空時頁尾只顯示服務名稱，不顯示任何連結——公開版就是這個狀態，
# 自行建置的單位不需要（也不應該）帶著本程式作者的連結。
ARG NEXT_PUBLIC_SITE_CREDIT_LABEL=
ARG NEXT_PUBLIC_SITE_CREDIT_URL=
ENV NEXT_PUBLIC_SITE_CREDIT_LABEL=${NEXT_PUBLIC_SITE_CREDIT_LABEL}
ENV NEXT_PUBLIC_SITE_CREDIT_URL=${NEXT_PUBLIC_SITE_CREDIT_URL}

# 建置期不連資料庫，只需要能通過型別檢查與編譯。
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3400
ENV HOSTNAME=0.0.0.0
ENV TZ=Asia/Taipei

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /data/uploads \
  && chown -R nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# 遷移檔要進映像檔，容器啟動時才能把資料庫升到最新版。
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrations ./src/db/migrations
# 初始法規文件：首次啟動且資料庫還沒有生效版本時自動匯入（見 src/lib/startup.ts）。
# 獨立輸出的檔案追蹤看不到「執行時才讀檔」的用法，所以要在這裡明確複製。
COPY --from=builder --chown=nextjs:nodejs /app/seed/checklist.md ./seed/checklist.md
COPY --from=builder --chown=nextjs:nodejs /app/seed/regulation.md ./seed/regulation.md

USER nextjs
EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3400/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
