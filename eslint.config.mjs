import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "云端知识库/**",
    ".verify-planet/**",
    // 产物目录：压测脚本、基线 JSON、验证快照等由工具生成，不是源码，
    // 不参与 lint（否则每次改动产物都会引入无意义的告警）。
    "artifacts/**",
    ".trae-html-share-packages/**",
  ]),
]);

export default eslintConfig;
