import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 底線開頭的參數代表「這裡刻意不用它，但簽章需要它」。
      // 擴充點（src/lib/email/hooks.ts）沒有掛任何東西時就是這種情況：
      // 函式必須維持原本的簽章讓呼叫端編得過，但本體什麼都不做。
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 公開版替身檔範本，理由同 tsconfig.json 的 exclude。
    "scripts/public-edition/**",
  ]),
]);

export default eslintConfig;
