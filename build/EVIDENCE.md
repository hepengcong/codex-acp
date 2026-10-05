# Build evidence

Last run: 2026-10-05. Re-run with the commands at the bottom; update this file when a result changes.

## Input

| | |
|---|---|
| Checked tree | `8308f97517af59641f8496797ff3fd0317afba27` = `HEAD^{tree}` of commit `886f21c769a233601beffdb7dec59379a4d5266c` (clean, `matchesHead: true`). One snapshot per run: typecheck, tests and both builds all used this tree |
| Upstream base | tag `v2.1.1` = `68d7d2d5ddfc0ed5746f9f6130892dda685e65dd` |
| Diff vs upstream in build inputs (`src/` except `src/__tests__/`, `build.mjs`, `package.json`, `package-lock.json`, `tsconfig.json`) | none |
| Diff vs upstream in tests | local patch `test-skip-binary` (3 test files, see `PROVENANCE.json`); tests are not bundled |
| Build config | upstream `build.mjs`, unchanged (esbuild, `src/index.ts`, platform node, ESM, `@openai/codex` external) |
| Build manifest | `build/package.json` + `build/package-lock.json`: 18 packages + 1 esbuild platform binary installed; every version and integrity equal to the upstream lockfile; `@openai/codex` absent; only `esbuild` has an install script, and it runs |
| Node / npm | 22.23.2 / 10.9.8 (pinned in `build/.nvmrc` and `engines`; the script refuses other versions) |
| esbuild | 0.28.2: `esbuild` package, `@esbuild/darwin-arm64` package and `esbuild --version` of the installed binary, checked in each build directory |
| Platform | macOS 26.5 (darwin), arm64 |

## Results

| Check | Result |
|---|---|
| Reproducible build: two fresh `git archive` directories of the checked tree, each with its own `npm ci` and build, byte-compared | **identical** |
| `dist/index.js` sha256 (both directories) | `4b76310393d756a0f111687cd9df899720f36f7c59b1eb1d86429484034ff91b` (1,512,086 bytes), unchanged by the test patch |
| npm tarball `@agentclientprotocol/codex-acp@2.1.1` integrity vs `PROVENANCE.json` | matches (`sha512-dppZxW3f…`) |
| npm `package/dist/index.js` sha256 | `4b76310393d756a0f111687cd9df899720f36f7c59b1eb1d86429484034ff91b`: **byte-identical** to the clean build |
| Typecheck (`npm run typecheck`, upstream script) | pass |
| Unit tests | 70 files (68 passed, 2 skipped as whole suites); 1063 tests passed, 22 skipped, 0 failed |
| Skipped tests vs `build/binary-tests.json` | exactly the declared set: 21 binary tests + 1 upstream skip (`records the baseline`) |
| Gate wall time (`cs:check`, warm npm cache) | about 1.5 min |

Compared with the first run of this PR (67 files, 968 passed, 1 skipped): 95 more tests run. They are the
mock-only tests in `CodexAcpClient.test.ts`, which used to be excluded as a whole file.

## Test environment

Typecheck, vitest and the esbuild step get this environment and nothing else (no inheritance):

| Variable | Value |
|---|---|
| `PATH` | directory of the running `node`, then `/usr/bin:/bin:/usr/sbin:/sbin` |
| `HOME` | throwaway directory (tests); the build directory (esbuild) |
| `TMPDIR` | the caller's temp root |
| `LANG` | `en_US.UTF-8` |
| `TZ` | `UTC` |
| `CODEX_HOME` | same throwaway directory as `HOME` (tests only) |
| `CODEX_ACP_SKIP_BINARY_TESTS` | `1` (tests only; local patch `test-skip-binary`) |
| `RECORD_SCENARIO_BASELINE` | `0` (tests only; never record baselines) |

vitest runs with `--update=none` (no snapshot is written, a missing one fails) and `--allowOnly=false`
(`.only` fails the run), so its behavior does not depend on `CI` or similar variables. e2e tests are excluded
by file glob. The `npm ci` installs keep the caller's environment, which carries registry and proxy settings.
The test install is the upstream lockfile with `@openai/codex` removed (192 packages), so the 333 MB Codex
binary is never downloaded.

The gate run above was started with `INITIAL_AGENT_MODE=agent-full-access`, `RECORD_SCENARIO_BASELINE=1`,
`CI=true` and a dummy `OPENAI_API_KEY` in the outer environment. The results were the same as above.

## Binary tests (skipped, listed in `build/binary-tests.json`)

21 tests start the real Codex binary: 17 in `CodexAcpClient.test.ts` (7 create their own real fixture, 10
use the shared one), the single test in `mcp-session.test.ts` and the 3 in `mcp-config-merge.test.ts`.
The gate requires exactly these to be skipped. The planned real-combination suite (real Codex CLI plus
the built artifact) takes them over.

## Reverse checks (run in throwaway clones)

| Change | Gate |
|---|---|
| Append to `src/index.ts` while the tests are running | Tests and both builds still report tree `8308f975…` and sha `4b763103…`; the run then fails: `working tree changed during the run` (exit 1) |
| Add `it.only` to a test | fails: vitest `Unexpected .only modifier` |
| Drop one title from `build/binary-tests.json` | fails: `skipped but not declared: …CodexAcpClient.test.ts > handles mcp command` |

## What this shows and what it does not

- The npm match only confirms where the first import came from: the published 2.1.1 bundle is what this
  source tree builds to. It is not the reproducibility check, and it stops matching by design once a
  patch with `affectsArtifact: true` lands.
- The reproducibility check is the two-directory comparison: same source tree, lockfile, toolchain and
  build config, built twice from scratch, same bytes.
- Not shown: a match across machines or platforms. Upstream published from Linux on Node 24 and the hash
  still matches here, which suggests esbuild's output does not depend on that difference for this tree,
  but only this machine and toolchain were tested.
- The binary tests are not run by this gate at all.

## Re-run

```sh
cd build && nvm use && cd ..          # Node 22.23.2 with npm 10.9.8
npm --prefix build run cs:check       # typecheck + unit tests + two-directory repro (pre-commit gate)
npm --prefix build run cs:npm-compare # clean build vs the npm 2.1.1 tarball (provenance only)
```

Before committing, check that the `tree` in the `[cs:result]` line equals the tree of the commit
(`git rev-parse HEAD^{tree}` after committing, or run the gate on the clean tree: `matchesHead: true`).
