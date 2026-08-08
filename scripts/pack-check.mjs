// Verify that `pnpm pack` produces a tarball whose package.json exports (and
// bin, when present) resolve to dist/, not src/ — the publishConfig rewrite
// that makes src-in-dev / dist-on-publish safe (SPEC §3: packages/snapgauge is
// the only npm-published package). Run after `pnpm -r build`. Fails loudly;
// CI treats a non-zero exit as red.
//
// SPEC §10 M7: also proves `npx snapgauge@1 ...` would work from a clean
// directory BEFORE publication — `npm install <tarball>` into a scratch
// project with none of this monorepo's workspace symlinks, then runs
// `snapgauge diff` (offline, no fixtures/network needed) on two snapshots.
// This is the one check the exports/bin inspection above cannot do: it
// proves the tarball's `files` entry actually SHIPS everything the CLI
// needs at runtime (including the `dependencies` — commander/undici/zod —
// resolving for real, not via this repo's hoisted node_modules) and that
// the installed bin file actually executes and prints the right thing.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const packages = ["packages/snapgauge"];

let failed = false;
for (const pkg of packages) {
  const tmp = mkdtempSync(join(tmpdir(), "snapgauge-pack-"));
  try {
    const out = execSync(`pnpm pack --pack-destination "${tmp}"`, {
      cwd: pkg,
      encoding: "utf8",
    }).trim();
    const tarball = out.split("\n").at(-1);
    // Extract with a RELATIVE path from inside tmp: GNU tar on Windows
    // interprets "C:" in an absolute path as a remote host ("Cannot connect").
    const tarballName = tarball.replace(/\\/g, "/").split("/").at(-1);
    execSync(`tar -xzf "${tarballName}"`, { cwd: tmp });
    const manifest = JSON.parse(readFileSync(join(tmp, "package", "package.json"), "utf8"));
    const exportsField = JSON.stringify(manifest.exports ?? {});
    if (exportsField.includes("src/")) {
      console.error(`FAIL ${pkg}: packed exports still point at src/ -> ${exportsField}`);
      failed = true;
    } else if (!exportsField.includes("dist/")) {
      console.error(`FAIL ${pkg}: packed exports do not point at dist/ -> ${exportsField}`);
      failed = true;
    } else {
      console.log(`ok   ${pkg}: packed exports -> dist/`);
    }
    // The CLI bin must point into dist/ AND the file must actually be in the
    // tarball — a bin that resolves to a missing file is a broken `npx snapgauge`.
    for (const [binName, binPath] of Object.entries(manifest.bin ?? {})) {
      if (!binPath.startsWith("./dist/") && !binPath.startsWith("dist/")) {
        console.error(`FAIL ${pkg}: bin "${binName}" points outside dist/ -> ${binPath}`);
        failed = true;
        continue;
      }
      try {
        statSync(join(tmp, "package", binPath));
        console.log(`ok   ${pkg}: bin "${binName}" -> ${binPath} (present in tarball)`);
      } catch {
        console.error(`FAIL ${pkg}: bin "${binName}" -> ${binPath} missing from tarball`);
        failed = true;
      }
    }

    if (pkg === "packages/snapgauge") {
      const tarballPath = join(tmp, tarballName);
      if (!smokeTestPackedTarball(tarballPath)) failed = true;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);

/**
 * `npm install <tarball>` into a directory with NONE of this monorepo's
 * workspace symlinks or hoisted devDependencies, then run the installed
 * bin's `diff` command (offline — no fixtures module, no network) against
 * two snapshots recorded here with the monorepo's own build. Returns true
 * on success.
 */
function smokeTestPackedTarball(tarballPath) {
  const snapDir = mkdtempSync(join(tmpdir(), "snapgauge-pack-check-snapshots-"));
  const scratchDir = mkdtempSync(join(tmpdir(), "snapgauge-pack-check-install-"));
  try {
    const cliDist = join(REPO_ROOT, "packages", "snapgauge", "dist", "cli", "index.js");
    const snapA = join(snapDir, "a.snapshot.json");
    const snapB = join(snapDir, "b.snapshot.json");
    // clean@v1 -> drift-breaking@v2: the exact pair the golden eval set
    // uses for its planted-breaking-drift case — a real, known-good
    // "before/after" pair, not a fabricated one.
    execFileSync(
      process.execPath,
      [
        cliDist,
        "record",
        "a",
        "--fixture",
        "clean@v1",
        "--dir",
        snapDir,
        "--recorded-at",
        "2026-01-01T00:00:00.000Z",
      ],
      { encoding: "utf8" },
    );
    execFileSync(
      process.execPath,
      [
        cliDist,
        "record",
        "b",
        "--fixture",
        "drift-breaking@v2",
        "--dir",
        snapDir,
        "--recorded-at",
        "2026-01-01T00:00:00.000Z",
      ],
      { encoding: "utf8" },
    );
    statSync(snapA);
    statSync(snapB);

    writeFileSync(
      join(scratchDir, "package.json"),
      JSON.stringify({ name: "snapgauge-pack-check-scratch", private: true, version: "0.0.0" }, null, 2),
    );
    execSync(`npm install "${tarballPath.replace(/\\/g, "/")}" --no-audit --no-fund --silent`, {
      cwd: scratchDir,
      encoding: "utf8",
      stdio: "pipe",
    });

    const installedManifest = JSON.parse(
      readFileSync(join(scratchDir, "node_modules", "snapgauge", "package.json"), "utf8"),
    );
    const binRelative = installedManifest.bin?.snapgauge;
    if (typeof binRelative !== "string") {
      console.error("FAIL packages/snapgauge: installed package.json has no bin.snapgauge entry");
      return false;
    }
    const installedBin = join(scratchDir, "node_modules", "snapgauge", binRelative);
    statSync(installedBin); // throws if the file did not actually ship

    const result = execFileSync(
      process.execPath,
      [installedBin, "diff", snapA, snapB, "--fail-on", "risky"],
      { encoding: "utf8", cwd: scratchDir },
    );
    // execFileSync throws on a non-zero exit; caught below and inspected —
    // a clean exit here would actually be unexpected (see the catch branch).
    return checkDiffOutput(result, 0);
  } catch (error) {
    // A non-zero exit IS the expected outcome here (clean@v1 vs
    // drift-breaking@v2 has breaking findings, default gate fails) —
    // inspect stdout/status rather than treating every throw as a failure.
    if (error && typeof error === "object" && "stdout" in error) {
      return checkDiffOutput(String(error.stdout ?? ""), error.status);
    }
    console.error(`FAIL packages/snapgauge: tarball smoke test threw: ${String(error)}`);
    return false;
  } finally {
    rmSync(snapDir, { recursive: true, force: true });
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

function checkDiffOutput(stdout, exitCode) {
  const okExit = exitCode === 1; // SPEC §5: drift at/above the default risky gate
  const okContent = stdout.includes("tool.removed") && stdout.includes("breaking");
  if (okExit && okContent) {
    console.log(
      "ok   packages/snapgauge: `npm install <tarball>` + `snapgauge diff` in a clean scratch dir " +
        "reproduced the planted breaking drift (exit 1, tool.removed present)",
    );
    return true;
  }
  console.error(
    `FAIL packages/snapgauge: tarball smoke test — exit ${String(exitCode)} (want 1), ` +
      `output ${okContent ? "contained" : "did NOT contain"} the expected finding`,
  );
  console.error(stdout);
  return false;
}
