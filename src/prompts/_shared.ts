import { stripControl } from "../sanitize.js";

/**
 * Make a user-supplied argument safe to interpolate into a prompt
 * body. Four defences stacked:
 *
 *   1. `stripControl` — drops C0/C1 control codes, zero-width
 *      formatters, BiDi overrides, BOM. Blocks invisibility tricks
 *      that would smuggle an instruction past a naive reader.
 *
 *   2. Collapse `\n` / `\r` to a space — inside a prompt a newline
 *      lets an attacker end their line and start a fresh numbered
 *      instruction on the next.
 *
 *   3. Drop `"` (ASCII 0x22) and the backtick `` ` `` — the prompt
 *      bodies interpolate user input inside double-quoted slots
 *      (`name: "${n}"`) and inside Markdown code spans
 *      (`\`mercury_list_recipients\``). A stray `"` closes the
 *      quoted slot and the tail of the arg reads as a fresh
 *      instruction; a stray backtick closes a code span and lets
 *      the attacker smuggle prose the LLM interprets.
 *
 *   4. `.trim()` so a trailing space doesn't produce a ragged echo
 *      in the rendered prompt.
 *
 * This is ONLY defence-in-depth — the MCP client is still the
 * authoritative source of user consent, and the confirmation gates
 * in the prompts remain load-bearing. But it closes the obvious
 * "paste a `"` or a newline into `recipientHint` to forge a
 * step 6" class of attack.
 */
export function promptSafe(value: string): string {
  return stripControl(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/["`]/g, "")
    .trim();
}
