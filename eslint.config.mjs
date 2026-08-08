// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.mjs", "scripts/*.mjs", "apps/*/*.mjs", "apps/*/e2e/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Boundary discipline (SPEC §9 / feasibility §4.2): no `as any` sneaking through.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // SPEC §3 boundary: src/core is pure, isomorphic, zero I/O — it must run
    // unchanged in a Vercel function, a browser Web Worker, and the CLI. Node
    // builtins are allowed in src/node/** and src/cli/** only. Tests are
    // exempt (they run under vitest on node and cross-check against
    // node:crypto etc.); the published build excludes them.
    files: ["packages/snapgauge/src/core/**/*.ts"],
    ignores: ["packages/snapgauge/src/core/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "fs",
                "path",
                "os",
                "crypto",
                "child_process",
                "url",
                "util",
                "stream",
                "events",
                "buffer",
                "http",
                "https",
                "net",
                "tls",
                "worker_threads",
              ],
              message:
                "SPEC §3 boundary: snapgauge core is isomorphic (browser Web Worker + Vercel function + CLI) and does zero I/O. Move node-dependent code to src/node/** or src/cli/**, or inject the capability through the Transport boundary.",
            },
          ],
        },
      ],
    },
  },
  {
    // SHA-256 hot loop: typed-array indexing under noUncheckedIndexedAccess.
    // Bounds are structurally guaranteed (fixed-size Uint32Array, loop
    // bounds); per-access guards would be noise. The FIPS vectors + the
    // node:crypto cross-check in sha256.test.ts are the real safety net.
    files: ["packages/snapgauge/src/core/sha256.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["**/*.mjs", "scripts/**"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  }
);
