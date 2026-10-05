// noinspection ES6RedundantAwait
// Modified in the Claudestra maintenance fork (hepengcong/codex-acp), per Apache-2.0 4(b):
// every test here starts the real Codex binary, so the suite skips when CODEX_ACP_SKIP_BINARY_TESTS=1.
// No effect when CODEX_ACP_SKIP_BINARY_TESTS is unset. See PROVENANCE.json, localPatches "test-skip-binary".

import {describe, expect, it, vi, beforeEach} from 'vitest';
import {createTestFixture, type TestFixture} from "../acp-test-utils";
import type {McpServerStdio} from "@agentclientprotocol/sdk";

describe.skipIf(process.env["CODEX_ACP_SKIP_BINARY_TESTS"] === "1")('MCP session configuration', { timeout: 40_000 }, () => {

    let fixture: TestFixture;
    beforeEach(() => {
        fixture = createTestFixture();
        vi.clearAllMocks();
    });


    it('should return configured mcp', async () => {
        const codexAcpAgent = fixture.getCodexAcpAgent();
        await codexAcpAgent.initialize({protocolVersion: 1});

        fixture.getCodexAcpClient().authRequired = vi.fn().mockResolvedValue(false);
        const mcpServer: McpServerStdio = {
            name: "test-mcp", command: "./node_modules/.bin/mcp-hello-world", args: ["example"], env: [{name:"example", value: "example"}]
        };

        const newSessionResponse = await codexAcpAgent.newSession({cwd: "", mcpServers: [mcpServer]});
        fixture.clearAcpConnectionDump();
        await codexAcpAgent.prompt({sessionId: newSessionResponse.sessionId, prompt: [{type: "text", text: "/mcp"}]});
        const transportDump = fixture.getAcpConnectionDump([]);
        expect(transportDump).contain("Configured MCP servers:");
        expect(transportDump).contain("- test-mcp");
    });

});
