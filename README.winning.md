# Winning customizations

An official LibreChat release plus the changes below, one `winning:` commit each; the branch name
says which release.

| Change | Why | Switched on by | Files | Upstream |
|---|---|---|---|---|
| Image generation through a gateway | Image requests go through a gateway that enforces usage quotas instead of straight to Google | `GEMINI_IMAGE_BASEURL` | `api/app/clients/tools/structured/GeminiImageGen.js`, applied outside this branch | Not proposed |
| Connector files as attachments | Files a trusted connector returns inside a tool result (documents, decks) are saved to the conversation, so people download them instead of the model reading their raw content | `persistResourceBlobs: true` on the connector in `librechat.yaml` | `api/server/services/MCP.js`, `api/server/services/MCP/persistResourceBlobs.js`, `api/server/controllers/agents/callbacks.js`, `packages/api/src/mcp/MCPManager.ts`, `packages/api/src/mcp/resources/`, `packages/api/src/mcp/types/index.ts`, `packages/api/src/index.ts`, `packages/data-provider/src/mcp.ts` | Not proposed |
| Send time on each message | Each user message tells the model when it was sent and in which time zone, so the instructions stay the same between turns and prompt caching keeps working | `endpoints.agents.promptMessageTimestamps` | `api/server/controllers/agents/client.js`, `packages/api/src/agents/client.ts`, `packages/data-provider/src/config.ts` | Not proposed |
| Web search without date and time in the instructions | Web search no longer adds the current date and time to the instructions, which broke prompt caching on every turn | Always on | `api/app/clients/tools/util/handleTools.js`, `api/server/services/ToolService.js`, `packages/api/src/tools/toolkits/web.ts` | Not proposed |
| No web search toggle in the chat input (temporary) | Web search stays on in the main mode, so the toggle is hidden | Always on | `client/src/hooks/Input/usePaletteEntries.tsx` | Not proposed |
