# ACP adapter for Codex CLI

> **Claudestra maintenance fork.** This repository (`hepengcong/codex-acp`) is a fork of
> [agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp), maintained
> so that Claudestra can pin the adapter by source
> (repository + commit) and by artifact fingerprint. It is not an official release channel.
>
> - **Base:** branch `cs/2.1.1` is upstream tag `v2.1.1` (commit `68d7d2d5`) with no changes.
>   Maintenance work lands on top of it through pull requests inside this fork.
> - **Provenance:** [`PROVENANCE.json`](PROVENANCE.json) records the upstream repository, tag,
>   commit, npm package and tarball integrity, license and copyright holder.
> - **Patches:** every change to upstream source or test files gets an entry in
>   `PROVENANCE.json` → `localPatches` (`id`, `summary`, `files`, `reason`, `affectsArtifact`,
>   `upstreamBase`, `upstreamRef` or `null`), and each modified file carries a notice at the top
>   saying it was changed here. Today there is one test-only patch (`test-skip-binary`); the
>   bundled source is upstream `v2.1.1` unchanged.
> - **Build and checks:** [`build/`](build/) holds a pinned build manifest, a reproducible
>   two-directory build and the local quality gate (`npm --prefix build run cs:check`).
>   Evidence of the last run: [`build/EVIDENCE.md`](build/EVIDENCE.md).
> - **License:** Apache-2.0, unchanged ([`LICENSE`](LICENSE), Copyright 2025 JetBrains s.r.o.).
>   Per Apache-2.0 §4(b): this README was modified in this fork (this section was added);
>   everything below it is upstream text.

[![npm version](https://img.shields.io/npm/v/%40agentclientprotocol%2Fcodex-acp)](https://www.npmjs.com/package/@agentclientprotocol/codex-acp)

Use [OpenAI Codex](https://github.com/openai/codex) from [Agent Client Protocol](https://agentclientprotocol.com/) clients.

`codex-acp` is a stdio ACP agent server. It starts the Codex App Server, translates ACP requests into Codex operations, and maps Codex events back into the client.

## Features

- ChatGPT, API key, and client-provided custom gateway authentication.
- Model, reasoning effort, fast mode, approval, and sandbox mode configuration.
- Concrete recommended model and reasoning-effort values through the opt-in [AIR recommended config values](docs/air-extensions.md#recommended-config-values) capability.
- Text prompts, embedded context, images, resource links, and additional workspace directories.
- Shell command, file change, [permission request](docs/air-extensions.md#permission-presentation), MCP tool call, terminal output, reasoning, plan, web search, image generation, image view, token usage, and review events.
- Compact file changes through the negotiated [AIR diff patch extension](docs/air-extensions.md#diff-patch).
- For AIR, one tool call shape with each fact in one field, as the [tool call contract](docs/air-extensions.md#tool-call-contract) defines. Other clients keep the earlier fields.
- [Native ACP subagent sessions](docs/subagent-sessions.md) (after capability negotiation) with separate child histories and root-routed permissions; a legacy tool-call fallback otherwise.
- [Background terminal tasks](docs/air-extensions.md#async-tasks) in AIR, with task status and targeted stop support after capability negotiation.
- Session-scoped long-running goals in AIR through the [goal extension](docs/air-extensions.md#goal).
- Typed warnings and errors through the opt-in [AIR session failure extension](docs/air-extensions.md#session-failure).
- All AIR extensions, capabilities, and `_meta` keys: [AIR extensions](docs/air-extensions.md).
- A per-turn [agent file-change report](docs/air-extensions.md#agent-file-change-report) after capability negotiation.
- Client-provided MCP servers over command-based stdio config and HTTP transport.
- Slash commands: `/status`, `/mcp`, `/skills`, `/goal`, `/review`, `/review-branch`, `/review-commit`, `/compact`, and `/logout`, as well as configured skills.

## Installation

Run the published package directly:

```bash
npx -y @agentclientprotocol/codex-acp
```

Or install it globally:

```bash
npm install -g @agentclientprotocol/codex-acp
codex-acp --version
```

The npm package includes a compatible `@openai/codex` dependency. Set `CODEX_PATH` only when you want the adapter to run a different Codex binary:

```bash
CODEX_PATH=/path/to/codex npx -y @agentclientprotocol/codex-acp
```

To try changes that have landed on `main` but are not released yet, install from the
`preview` channel. Pushes to `main` trigger preview publishing without waiting
for CI or release-please; release commits are excluded, and newer pushes can
replace queued previews. See
[docs/RELEASES.md](docs/RELEASES.md#preview-releases).

```bash
npx -y @agentclientprotocol/codex-acp@preview
```

## Authentication

The adapter advertises ACP auth methods during initialization. Clients can authenticate with:

- ChatGPT login. Set `NO_BROWSER=1` to hide this method in remote or browserless environments.
- API key via `CODEX_API_KEY` or `OPENAI_API_KEY`.
- A custom OpenAI-compatible gateway, when the client opts in to the gateway auth capability.

## Runtime options

- `CODEX_API_KEY` - API key used when the API-key auth method is selected. Takes precedence over `OPENAI_API_KEY`.
- `OPENAI_API_KEY` - fallback API key used when the API-key auth method is selected.
- `CODEX_PATH` - run a specific Codex executable instead of the bundled package dependency.
- `CODEX_CONFIG` - JSON object merged into the Codex session config.
- `MODEL_PROVIDER` - model provider to pass to Codex for new sessions.
- `DEFAULT_AUTH_REQUEST` - ACP auth request JSON used when Codex requires authentication.
- `INITIAL_AGENT_MODE` - initial mode id: `read-only`, `workspace-write`, `agent`, or `agent-full-access`.
- `NO_BROWSER` - hide browser-based ChatGPT auth when set.
- `APP_SERVER_LOGS` - directory for adapter logs.

## Development

```bash
npm install
npm run start
npm run typecheck
npm test
```

Build standalone binaries in `dist/bin` with:

```bash
npm run bundle:all
```

See [readme-dev.md](readme-dev.md) for local client configuration, binary packaging, and Codex type regeneration.

### Subagent sessions

Subagent sessions follow the draft [ACP subagent RFD](https://github.com/agentclientprotocol/agent-client-protocol/pull/1992) and are enabled only after bilateral capability negotiation during `initialize`. Without native negotiation, the subagent lifecycle stays an ordinary ACP tool call.

See [docs/subagent-sessions.md](docs/subagent-sessions.md) for the negotiation, lifecycle events, `session/load` reconstruction, and legacy fallback details.

### Background terminal tasks

Codex can keep a shell command running after a turn continues. AIR clients can show this work in the Async Tasks panel and stop one command.

See [AIR extensions](docs/air-extensions.md#async-tasks) for the capability, lifecycle events, and stop request.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
