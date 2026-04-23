/**
 * Make a user-supplied argument safe to interpolate into a prompt
 * body. Strip every character that is not on the NACHA Addenda
 * Record's "Payment Related Information" allowlist:
 *
 *   alphanumerics, space, and
 *   ( ) ! # $ % & ' * + - . / : ; = ? @ [ ] ^ _ { | }
 *
 * That single rule blocks the concrete injection vectors at once:
 *
 *   - control codes, zero-width formatters, BiDi overrides, BOM —
 *     all outside the allowlist;
 *   - `\n` / `\r` — outside the allowlist, cannot smuggle a fresh
 *     numbered instruction;
 *   - `"` — closes the quoted slot `name: "${n}"` in prompt bodies,
 *     outside the allowlist;
 *   - backtick — closes a Markdown code span, outside the allowlist;
 *   - `,`, `<`, `>`, `\`, `~`, non-ASCII letters — all outside.
 *
 * Defence-in-depth only: the MCP client remains the authoritative
 * source of user consent, and the confirmation gates in the
 * prompts stay load-bearing. The allowlist just eliminates every
 * known "paste a weird char into recipientHint to forge a step 6"
 * class of attack.
 *
 * Trade-off: Unicode letters (`é`, `漢字`, emoji) are dropped
 * along with the attack chars. Acceptable for a US-banking MCP
 * where the attacker-reachable surface is the recipient/customer
 * name / memo, and where ASCII is the documented target anyway.
 */
const NACHA_ALLOWLIST = /[^A-Za-z0-9 ()!#$%&'*+\-./:;=?@[\]^_{|}]/g;

export function promptSafe(value: string): string {
  return value.replace(NACHA_ALLOWLIST, "").trim();
}
