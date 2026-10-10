import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOLD_RATE_TTL_MS,
  readGoldRate,
  resetGoldRateCache,
} from "../src/services/gold-rate.js";

const T0 = new Date("2026-10-10T12:00:00.000Z");
const at = (msAfterT0: number) => new Date(T0.getTime() + msAfterT0);

describe("gold rate TTL cache", () => {
  beforeEach(() => {
    resetGoldRateCache();
  });

  it("fetches on the first read and serves later reads inside the TTL from cache", () => {
    const fetchRate = vi.fn(() => 7123);

    const first = readGoldRate({ now: at(0), fetchRate });
    expect(first.cacheHit).toBe(false);
    expect(first.rate).toMatchObject({
      ratePerGramRupees: 7123,
      currency: "INR",
      source: "mock-reference",
      asOf: T0.toISOString(),
    });
    expect(first.expiresAt).toBe(at(GOLD_RATE_TTL_MS).toISOString());

    const second = readGoldRate({ now: at(60_000), fetchRate });
    expect(second.cacheHit).toBe(true);
    expect(second.rate).toEqual(first.rate);
    expect(fetchRate).toHaveBeenCalledTimes(1);
  });

  it("refreshes at exactly the TTL boundary, not before", () => {
    const fetchRate = vi
      .fn<() => number>()
      .mockReturnValueOnce(7000)
      .mockReturnValueOnce(7100);

    readGoldRate({ now: at(0), fetchRate });

    const justBeforeExpiry = readGoldRate({
      now: at(GOLD_RATE_TTL_MS - 1),
      fetchRate,
    });
    expect(justBeforeExpiry.cacheHit).toBe(true);
    expect(justBeforeExpiry.rate.ratePerGramRupees).toBe(7000);

    const atExpiry = readGoldRate({ now: at(GOLD_RATE_TTL_MS), fetchRate });
    expect(atExpiry.cacheHit).toBe(false);
    expect(atExpiry.rate.ratePerGramRupees).toBe(7100);
    expect(atExpiry.rate.asOf).toBe(at(GOLD_RATE_TTL_MS).toISOString());
    expect(fetchRate).toHaveBeenCalledTimes(2);
  });

  it("treats an explicit reset as invalidation: the next read misses", () => {
    const fetchRate = vi.fn(() => 7000);

    const first = readGoldRate({ now: at(0), fetchRate });
    expect(first.cacheHit).toBe(false);

    resetGoldRateCache();

    const afterReset = readGoldRate({ now: at(1), fetchRate });
    expect(afterReset.cacheHit).toBe(false);
    expect(fetchRate).toHaveBeenCalledTimes(2);
  });

  it("defaults to the shared mock reference rate and labels the source", () => {
    const read = readGoldRate({ now: at(0) });

    expect(read.rate.ratePerGramRupees).toBe(7000);
    expect(read.rate.source).toBe("mock-reference");
    expect(read.cacheHit).toBe(false);
  });
});
