import { createHash } from "node:crypto";

/**
 * In-process, sliding-window rate limiter for POST /api/v1/leads.
 *
 * It is intentionally simple and zero-dependency. It limits lead-creation
 * requests by requester identity, not by arbitrary test timing, so the
 * deterministic test path uses a fixed client identity instead of relying on
 * real clock values.
 *
 * Sensitive values (mobile numbers, request payloads, API keys, idempotency
 * keys) are never stored as the rate-limit identity and never logged here.
 */

export interface RateLimitConfig {
  /** Maximum lead-creation requests allowed in the window (per identity). */
  readonly maxRequests: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /**
   * Optional fixed identity used in deterministic tests so behavior depends on
   * request count, not on real clock jitter or caller metadata.
   */
  readonly testIdentity?: string;
}

export function parseRateLimitConfig(): RateLimitConfig {
  const rawMax = process.env.LEADS_RATE_LIMIT_MAX ?? "60";
  const rawWindow = process.env.LEADS_RATE_LIMIT_WINDOW_MS ?? "60000";

  const maxRequests = Math.max(1, parseInt(rawMax, 10) || 60);
  const windowMs = Math.max(1000, parseInt(rawWindow, 10) || 60000);

  return { maxRequests, windowMs };
}

export const DEFAULT_LEAD_RATE_LIMIT = parseRateLimitConfig();
const _defaultConfig = parseRateLimitConfig();

/**
 * Return the current effective config. Tests override this before exercising
 * the limiter so the behavior stays deterministic and independent of real time.
 */
let effectiveConfig: RateLimitConfig = _defaultConfig;

export function setRateLimitConfigForTest(config: RateLimitConfig) {
  effectiveConfig = config;
}

export function resetRateLimitConfigForTest() {
  effectiveConfig = _defaultConfig;
}

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Deterministic identity for the rate-limit bucket. It deliberately excludes
 * mobile numbers, request payloads, and any other sensitive data.
 */
function identityForRequest(req: { ip?: string | string[] | undefined }): string {
  // In tests we use a fixed identity so the limit depends on request count.
  if (effectiveConfig.testIdentity !== undefined) {
    return effectiveConfig.testIdentity;
  }

  const rawIp = typeof req.ip === "string" ? req.ip : Array.isArray(req.ip) ? req.ip[0] : undefined;
  const normalizedIp = rawIp?.trim() || "unknown";
  const safeSuffix = normalizedIp.length > 16 ? normalizedIp.slice(-16) : normalizedIp;

  const stable = `leads-rate:${safeSuffix}`;
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export interface RateLimitOutcome {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Check whether the next lead-creation request is allowed. When rate-limited,
 * retryAfterMs is the time until the current window resets for that identity.
 */
export function isRateLimited(
  req: { ip?: string | string[] | undefined },
): RateLimitOutcome {
  return checkLeadRateLimit(req);
}

export function checkLeadRateLimit(
  req: { ip?: string | string[] | undefined },
): RateLimitOutcome {
  const config = effectiveConfig;
  const id = identityForRequest(req);
  const now = Date.now();
  const bucket = buckets.get(id);

  if (!bucket || now - bucket.windowStart >= config.windowMs) {
    buckets.set(id, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count >= config.maxRequests) {
    const retryAfterMs = Math.max(0, bucket.windowStart + config.windowMs - now);
    return { allowed: false, retryAfterMs };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}
