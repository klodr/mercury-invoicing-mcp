/**
 * Property-based (fuzz) tests for security-sensitive helpers.
 * Uses fast-check, recognised by OpenSSF Scorecard's Fuzzing check
 * for the JS/TS ecosystem.
 *
 * The goal isn't to assert specific values — it's to throw a *lot* of
 * weird inputs at functions whose correctness is hard to enumerate by
 * hand (deep recursion, nested arrays/objects, mixed types).
 */

import * as fc from "fast-check";
import { redactSensitive, SENSITIVE_KEYS } from "../src/middleware.js";
import { MercuryError } from "../src/client.js";

// SENSITIVE_KEYS is imported from src/middleware.ts so the property tests
// stay in sync with the canonical list — no risk of drift.

// Mixed-case variants exercise the `.toLowerCase()` path inside
// redactSensitive. If a future refactor drops case-folding, the property
// will fail on any of the variants below.
const mixedCaseKeys = SENSITIVE_KEYS.flatMap((k) => [
  k.toUpperCase(),
  k.charAt(0).toUpperCase() + k.slice(1),                                    // PascalCase
  [...k].map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c)).join(""),        // alternating
]);

describe("Fuzz: redactSensitive", () => {
  it("never leaks any value stored under a sensitive key, at any depth", () => {
    fc.assert(
      fc.property(
        // Build an arbitrary value: primitives, arrays, or objects with a mix
        // of sensitive and non-sensitive keys (including mixed-case variants).
        fc.letrec((tie) => ({
          value: fc.oneof(
            { maxDepth: 4 },
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.array(tie("value"), { maxLength: 5 }),
            fc.dictionary(
              fc.oneof(
                fc.constantFrom(...SENSITIVE_KEYS, ...mixedCaseKeys),
                fc.string({ minLength: 1, maxLength: 8 }),
              ),
              tie("value"),
              { maxKeys: 5 },
            ),
          ),
        })).value,
        (input) => {
          const out = redactSensitive(input);
          // Walk both side-by-side and assert: any key whose lowercased
          // name is in SENSITIVE_KEYS must have value "[REDACTED]" in `out`.
          const stack: Array<{ a: unknown; b: unknown }> = [{ a: input, b: out }];
          while (stack.length > 0) {
            const { a, b } = stack.pop()!;
            if (a === null || typeof a !== "object") continue;
            if (Array.isArray(a)) {
              if (!Array.isArray(b) || b.length !== a.length) return false;
              for (let i = 0; i < a.length; i++) stack.push({ a: a[i], b: b[i] });
              continue;
            }
            const ao = a as Record<string, unknown>;
            const bo = b as Record<string, unknown>;
            for (const k of Object.keys(ao)) {
              if (SENSITIVE_KEYS.includes(k.toLowerCase() as (typeof SENSITIVE_KEYS)[number])) {
                if (bo[k] !== "[REDACTED]") return false;
              } else {
                stack.push({ a: ao[k], b: bo[k] });
              }
            }
          }
          return true;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("preserves all non-sensitive keys verbatim", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          // Only non-sensitive keys
          fc.string({ minLength: 1, maxLength: 8 }).filter(
            (k) => !SENSITIVE_KEYS.includes(k.toLowerCase() as (typeof SENSITIVE_KEYS)[number]),
          ),
          fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
          { maxKeys: 8 },
        ),
        (input) => {
          const out = redactSensitive(input) as Record<string, unknown>;
          for (const k of Object.keys(input)) {
            if (out[k] !== input[k]) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("leaves primitives and null unchanged", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.float(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (v) => Object.is(redactSensitive(v), v),
      ),
    );
  });
});

describe("Fuzz: MercuryError serialisation", () => {
  // Use a sentinel that fast-check's string arbitraries cannot reasonably
  // produce, AND filter `message` to make sure it never collides — otherwise
  // a chance match in `message` would falsely fail the property.
  const SENTINEL = "__LEAK_SENTINEL_4f9c2b__";
  const safeMessage = fc.string({ minLength: 1, maxLength: 50 }).filter((m) => !m.includes(SENTINEL));

  it("toString never leaks the response body", () => {
    fc.assert(
      fc.property(
        safeMessage,
        fc.integer({ min: 100, max: 599 }), // status
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string()), // body
        (message, status, body) => {
          // Tag every body value with the sentinel so we can grep for it.
          const tagged: Record<string, string> = {};
          for (const [k, v] of Object.entries(body)) tagged[k] = `${SENTINEL}${v}`;

          const err = new MercuryError(message, status, tagged);
          // None of the tagged values should appear in the string form.
          return !err.toString().includes(SENTINEL);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("toJSON never leaks the response body", () => {
    fc.assert(
      fc.property(
        safeMessage,
        fc.integer({ min: 100, max: 599 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.string()),
        (message, status, body) => {
          const tagged: Record<string, string> = {};
          for (const [k, v] of Object.entries(body)) tagged[k] = `${SENTINEL}${v}`;
          const err = new MercuryError(message, status, tagged);
          return !JSON.stringify(err.toJSON()).includes(SENTINEL);
        },
      ),
      { numRuns: 200 },
    );
  });
});
