# Build evidence

Last run: 2026-10-05. Re-run with the commands at the bottom; update this file when a result changes.

## Input

| | |
|---|---|
| Source commit | `e8d88a2657c2ac3b71bf3d61b39f285f74f65cfd` (tree `60c271a446260b5b1608afcdc68bdc373e514147`), clean |
| Upstream base | tag `v2.1.1` = `68d7d2d5ddfc0ed5746f9f6130892dda685e65dd` |
| Diff vs upstream in build inputs (`src/`, `build.mjs`, `package.json`, `package-lock.json`, `tsconfig.json`) | none |
| Build config | upstream `build.mjs`, unchanged (esbuild, `src/index.ts`, platform node, ESM, `@openai/codex` external) |
| Build manifest | `build/package.json` + `build/package-lock.json`: 18 packages + 1 esbuild platform binary installed; every version and integrity equal to the upstream lockfile; `@openai/codex` absent; only `esbuild` has an install script, and it runs |
| Node / npm | 22.23.2 / 10.9.8 (pinned in `build/.nvmrc` and `engines`; the script refuses other versions) |
| esbuild | 0.28.2: `esbuild` package, `@esbuild/darwin-arm64` package and `esbuild --version` of the installed binary, checked in each build directory |
| Platform | macOS 26.5 (darwin), arm64 |

## Results

| Check | Result |
|---|---|
| Reproducible build: two fresh `git archive` directories, each with its own `npm ci` and build, byte-compared | **identical** |
| `dist/index.js` sha256 (both directories) | `4b76310393d756a0f111687cd9df899720f36f7c59b1eb1d86429484034ff91b` (1,512,086 bytes) |
| npm tarball `@agentclientprotocol/codex-acp@2.1.1` integrity vs `PROVENANCE.json` | matches (`sha512-dppZxW3f…`) |
| npm `package/dist/index.js` sha256 | `4b76310393d756a0f111687cd9df899720f36f7c59b1eb1d86429484034ff91b`: **byte-identical** to the clean build |
| Typecheck (`npm run typecheck`, upstream script) | pass |
| Unit tests (upstream `vitest run --no-file-parallelism --retry=2` minus the exclusions below) | 67 files passed; 968 tests passed, 1 skipped (`records the baseline`, upstream `runIf(RECORD_SCENARIO_BASELINE)`) |
| Gate wall time (`cs:check`, warm npm cache) | about 1.5 min |

## Excluded from the gate

| Tests | Why |
|---|---|
| `src/__tests__/CodexACPAgent/e2e/**` (6 files) | drive a live model, need `OPENAI_API_KEY` |
| `CodexAcpClient.test.ts`, `mcp-session.test.ts` | `beforeEach` spawns the real Codex binary from `node_modules/.bin/codex` |
| `mcp-config-merge.test.ts` | spawns the bundled `@openai/codex` |

The test install is the upstream lockfile with `@openai/codex` removed (192 packages), so the 333 MB Codex
binary is never downloaded. Tests run with `HOME` and `CODEX_HOME` pointed at a throwaway directory, and
with `OPENAI_API_KEY`, `CODEX_API_KEY`, `RUN_E2E_TESTS`, `CODEX_PATH` and `CODEX_CONFIG` removed from the environment.

## What this shows and what it does not

- The npm match only confirms where the first import came from: the published 2.1.1 bundle is what this
  source tree builds to. It is not the reproducibility check, and it stops matching by design once
  `localPatches` is non-empty.
- The reproducibility check is the two-directory comparison: same source tree, lockfile, toolchain and
  build config, built twice from scratch, same bytes.
- Not shown: a match across machines or platforms. Upstream published from Linux on Node 24 and the hash
  still matches here, which suggests esbuild's output does not depend on that difference for this tree,
  but only this machine and toolchain were tested.

## Re-run

```sh
cd build && nvm use && cd ..          # Node 22.23.2 with npm 10.9.8
npm --prefix build run cs:check       # typecheck + unit tests + two-directory repro (pre-commit gate)
npm --prefix build run cs:npm-compare # clean build vs the npm 2.1.1 tarball (provenance only)
```
