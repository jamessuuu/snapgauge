import type { NextConfig } from "next";

/**
 * NextConfig types `webpack`'s config parameter as `any` (Next does not
 * depend on webpack's own types) — this is the narrow shape this file
 * actually touches, typed explicitly so the assignment is not `any`.
 */
interface WebpackConfigShape {
  resolve?: { extensionAlias?: Record<string, string[]> };
  [key: string]: unknown;
}

/**
 * SPEC §3: `snapgauge` and `@snapgauge/fixtures` are workspace packages whose
 * "exports" resolve to raw `.ts` sources (never compiled), so Next must
 * transpile them itself rather than treating them as opaque `node_modules`.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["snapgauge", "@snapgauge/fixtures"],
  // Next.js 16 removed `next lint` and the `eslint` config option entirely —
  // linting is owned by the root flat config (`pnpm lint`), which already
  // covers apps/web.
  //
  // Both workspace packages' relative imports use real ".js" specifiers that
  // resolve against ".ts" source (TS "NodeNext" convention — the same
  // convention this app's own src/lib/*.ts files follow). Turbopack does not
  // currently transpile pnpm workspace packages correctly in a monorepo
  // (vercel/next.js#85315/#85316, open as of Next 16.3.0) — package.json's
  // dev/build/start scripts pin `--webpack` for that reason. The
  // `extensionAlias` below is webpack's half of the fix (mapping ".js"
  // specifiers to ".ts" files when only the source exists); `turbopack.
  // resolveExtensions` is left in place too in case `next dev` is ever run
  // without `--webpack`, though it does not fix the transpilePackages bug.
  webpack(config: WebpackConfigShape): WebpackConfigShape {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
  },
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
