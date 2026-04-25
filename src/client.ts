/**
 * Mercury API client
 * Docs: https://docs.mercury.com/reference/getting-started-with-your-api
 */

import { assertSafeUrl } from "./safe-url.js";

const BASE_URL = "https://api.mercury.com/api/v1";

export interface MercuryClientOptions {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Cap on `MercuryError.message` length. Mercury error messages can
 * legitimately echo upstream content (an invoice memo, a counterparty
 * name, a rejected field) that an attacker may have influenced. The
 * fence + control-char strip in `sanitizeForLlm` already neutralise
 * the structural risk; the cap is a *budget* control to stop a
 * pathological 1 MB error from saturating the LLM context window.
 *
 * The cut is structured: keep the first ~half of the budget and the
 * last ~half, with a clearly labelled marker in between, so a reader
 * (human or model) sees both the leading and trailing context. Net
 * length is bounded by `MERCURY_ERROR_MESSAGE_MAX` plus the marker.
 */
export const MERCURY_ERROR_MESSAGE_MAX = 2048;
const TRUNCATION_MARKER = " ... [truncated] ... ";

function capErrorMessage(message: string, max: number = MERCURY_ERROR_MESSAGE_MAX): string {
  if (message.length <= max) return message;
  // Reserve the marker length out of the budget so the final string is
  // always ≤ max + marker (predictable upper bound for callers).
  const headLen = Math.ceil((max - TRUNCATION_MARKER.length) / 2);
  const tailLen = Math.floor((max - TRUNCATION_MARKER.length) / 2);
  return message.slice(0, headLen) + TRUNCATION_MARKER + message.slice(-tailLen);
}

export class MercuryError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    // Cap upstream-influenced bytes at the source so every consumer of
    // `err.message` (the LLM error channel, logs, debuggers) sees the
    // same bounded value.
    super(capErrorMessage(message));
    this.name = "MercuryError";
  }

  // Override default toString/JSON to keep the body out of accidental
  // string interpolation (it may contain sensitive Mercury responses).
  toString(): string {
    return `MercuryError: ${this.message} (status: ${this.status})`;
  }
  toJSON(): unknown {
    return { name: this.name, message: this.message, status: this.status };
  }
}

export class MercuryClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: MercuryClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    init: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    // Encode each path segment so user-supplied IDs cannot smuggle additional
    // path components or query strings into the Mercury URL (defense-in-depth
    // even though every ID-bearing tool input also requires .uuid() at the
    // schema level).
    const encodedPath = path
      .split("/")
      .map((seg, i) => (i === 0 || seg.length === 0 ? seg : encodeURIComponent(seg)))
      .join("/");
    const url = new URL(this.baseUrl + encodedPath);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    // Runtime SSRF defense: re-resolve the URL hostname and reject if any
    // record points at a non-`unicast` range. Combined with the boot-time
    // `validateBaseUrl()` check this closes DNS-rebinding + redirect-into-
    // private-host gaps without migrating off the native fetch API.
    await assertSafeUrl(url);

    const res = await fetch(url, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(30_000),
      // `redirect: "manual"` would let us re-classify each Location hop,
      // but Mercury's API does not redirect — keep `follow` (default) and
      // rely on the boot + assertSafeUrl coverage. If a future endpoint
      // ever sends a 30x, the response status surfaces it.
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // non-JSON response, leave as text
      json = text;
    }

    if (!res.ok) {
      throw new MercuryError(
        `Mercury API ${method} ${path} failed: ${res.status} ${res.statusText}`,
        res.status,
        json,
      );
    }

    // Some endpoints (DELETE, idempotent updates) return empty 204 — coerce to a
    // marker object so handlers always have something to JSON.stringify.
    if (json === undefined) return { ok: true } as T;

    return json as T;
  }

  // Convenience helpers
  get<T = unknown>(path: string, query?: Record<string, string | number | undefined>) {
    return this.request<T>("GET", path, { query });
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body });
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, { body });
  }
  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }
}
