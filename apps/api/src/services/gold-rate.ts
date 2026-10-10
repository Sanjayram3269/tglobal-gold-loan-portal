import { MOCK_GOLD_RATE_PER_GRAM } from "../domain/loan-calculator.js";

/**
 * How long one rate read is served from memory before the source is
 * consulted again. The cache is process-local and explicit: there is no
 * background refresh and no external service.
 */
export const GOLD_RATE_TTL_MS = 5 * 60 * 1000;

export interface GoldRateSnapshot {
  ratePerGramRupees: number;
  currency: "INR";
  /**
   * The only configured source is the portal's shared mock reference rate
   * (MOCK_GOLD_RATE_PER_GRAM in the loan calculator). This is not a live
   * market feed.
   */
  source: "mock-reference";
  /** When the source was consulted for this value (cache-fill time). */
  asOf: string;
}

export interface GoldRateRead {
  rate: GoldRateSnapshot;
  cacheHit: boolean;
  expiresAt: string;
}

interface CacheEntry {
  snapshot: GoldRateSnapshot;
  fetchedAtMs: number;
}

let cache: CacheEntry | null = null;

function defaultFetchRate(): number {
  return MOCK_GOLD_RATE_PER_GRAM.toNumber();
}

export function readGoldRate(
  options: {
    now?: Date;
    ttlMs?: number;
    fetchRate?: () => number;
  } = {},
): GoldRateRead {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? GOLD_RATE_TTL_MS;
  const fetchRate = options.fetchRate ?? defaultFetchRate;

  if (cache && now.getTime() - cache.fetchedAtMs < ttlMs) {
    return {
      rate: cache.snapshot,
      cacheHit: true,
      expiresAt: new Date(cache.fetchedAtMs + ttlMs).toISOString(),
    };
  }

  const ratePerGramRupees = fetchRate();
  const snapshot: GoldRateSnapshot = {
    ratePerGramRupees,
    currency: "INR",
    source: "mock-reference",
    asOf: now.toISOString(),
  };
  cache = { snapshot, fetchedAtMs: now.getTime() };

  return {
    rate: snapshot,
    cacheHit: false,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

/** Explicit invalidation: the next read misses and consults the source. */
export function resetGoldRateCache(): void {
  cache = null;
}
