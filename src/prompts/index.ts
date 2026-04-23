import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRecipePrompts } from "./recipes.js";

/**
 * Register every user-facing prompt (slash command) on the server.
 * Calling `server.registerPrompt` even once auto-enables the `prompts`
 * capability on the initialise handshake — no explicit capability
 * declaration required here.
 */
export function registerAllPrompts(server: McpServer): void {
  registerRecipePrompts(server);
}
