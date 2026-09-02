import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["src/modules/**/ui/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/modules/cycles/application/cycles",
              message:
                "Client Components must import cycle contracts from the browser-safe domain module.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".pnpm-store/**",
    ".worktrees/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
