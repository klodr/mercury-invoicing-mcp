import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodRawShape } from "zod";
import { wrapToolHandler, type ToolResult } from "../middleware.js";
import { sanitizeJsonValues } from "../sanitize.js";

export type { ToolResult };
export type { ToolAnnotations };

/**
 * Build a ToolResult from a JSON-shaped response. The LLM-display
 * surface (`content[0].text`) is a parseable JSON string with every
 * value stripped of control / zero-width / BiDi characters — the
 * "ping-pong" injection vector where attacker-supplied customer
 * names, memos, or error echoes smuggle instructions back through
 * the LLM. `structuredContent` carries the same sanitized shape for
 * programmatic consumers (per MCP spec 2025-06-18+).
 */
export function textResult(data: unknown): ToolResult {
  // Walk the payload once, reuse the sanitized value for both the
  // LLM-display JSON string and the `structuredContent` object.
  // Calling sanitizeJsonForLlm(data) + sanitizeJsonValues(data)
  // separately would run the walker twice on the same input.
  const sanitized = sanitizeJsonValues(data);
  return {
    content: [{ type: "text", text: JSON.stringify(sanitized, null, 2) }],
    structuredContent: (sanitized ?? {}) as Record<string, unknown>,
  };
}

export function defineTool<S extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
  annotations: ToolAnnotations,
): void {
  const wrapped = wrapToolHandler(name, handler);
  const strictSchema = z.object(inputSchema).strict();
  // MCP behavioral annotations (readOnlyHint / destructiveHint /
  // idempotentHint / openWorldHint) — declared machine-readable so
  // hosts and rubrics (TDQS / Glama Behavior dimension) can detect
  // tool semantics without scraping the prose description. Required
  // (not optional) so every new tool ships with explicit semantics —
  // forgetting the annotation now fails typecheck instead of
  // silently shipping a tool with no hint set.
  server.registerTool(name, { description, inputSchema: strictSchema, annotations }, wrapped);
}
