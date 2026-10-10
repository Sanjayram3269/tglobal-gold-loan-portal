import { describe, expect, it, vi } from "vitest";
import {
  purgeExpiredIdempotencyRecords,
  type RetentionClient,
} from "../src/services/idempotency-retention.js";

// The retention service imports the shared Prisma client, which requires
// DATABASE_URL at import time. CI has no database, and every test injects its
// own client, so the real module is replaced the same way the other suites do.
vi.mock("../src/lib/prisma.js", () => ({ prisma: {} }));

type StoredRecord = { key: string; createdAt: Date };

const T0 = new Date("2026-10-10T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const at = (hoursAfterT0: number) => new Date(T0.getTime() + hoursAfterT0 * HOUR_MS);

function makeStatefulClient(initial: StoredRecord[]) {
  const state: { records: StoredRecord[] } = { records: [...initial] };

  const findMany = vi.fn(
    async (args: {
      where: { createdAt: { lt: Date } };
      orderBy: { createdAt: "asc" };
      take: number;
    }) =>
      state.records
        .filter((record) => record.createdAt < args.where.createdAt.lt)
        .sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        )
        .slice(0, args.take)
        .map((record) => ({ key: record.key, createdAt: record.createdAt })),
  );

  const deleteMany = vi.fn(
    async (args: {
      where: { key: { in: string[] }; createdAt: { lt: Date } };
    }) => {
      const keys = new Set(args.where.key.in);
      const before = state.records.length;
      state.records = state.records.filter(
        (record) =>
          !(keys.has(record.key) && record.createdAt < args.where.createdAt.lt),
      );
      return { count: before - state.records.length };
    },
  );

  const client: RetentionClient = { idempotencyRecord: { findMany, deleteMany } };
  return { client, state, findMany, deleteMany };
}

describe("idempotency retention cleanup", () => {
  it("retains records newer than the cutoff, including the exact boundary", async () => {
    const { client, state, deleteMany } = makeStatefulClient([
      { key: "recent-1", createdAt: at(47) },
      { key: "boundary", createdAt: at(48) },
    ]);

    const result = await purgeExpiredIdempotencyRecords({
      mode: "preview",
      client,
      now: at(48),
    });

    expect(result.selected).toBe(0);
    expect(result.deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(state.records).toHaveLength(2);
  });

  it("selects only records older than the cutoff using the controlled clock and the default 48h window", async () => {
    const { client, findMany } = makeStatefulClient([
      { key: "old-2", createdAt: at(-60) },
      { key: "recent", createdAt: at(40) },
      { key: "old-1", createdAt: at(-50) },
    ]);

    const result = await purgeExpiredIdempotencyRecords({
      mode: "preview",
      client,
      now: at(48),
    });

    expect(result.cutoff.toISOString()).toBe(T0.toISOString());
    expect(result.selected).toBe(2);
    expect(result.sampleKeys).toEqual(["old-2", "old-1"]);
    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: T0 } },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { key: true, createdAt: true },
    });
  });

  it("bounds the work per run to the configured limit", async () => {
    const records = Array.from({ length: 5 }, (_, index) => ({
      key: `old-${index}`,
      createdAt: at(-1 - index),
    }));
    const { client, state, findMany } = makeStatefulClient(records);

    const result = await purgeExpiredIdempotencyRecords({
      mode: "apply",
      client,
      limit: 2,
      now: at(48),
    });

    expect(result.selected).toBe(2);
    expect(result.deleted).toBe(2);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].take).toBe(2);
    expect(result.sampleKeys).toHaveLength(2);
    // Remaining eligible records stay for the next bounded run.
    expect(state.records).toHaveLength(3);
  });

  it("preview mode never deletes anything", async () => {
    const { client, state, deleteMany } = makeStatefulClient([
      { key: "old", createdAt: at(-100) },
    ]);

    const result = await purgeExpiredIdempotencyRecords({
      mode: "preview",
      client,
      now: at(48),
    });

    expect(result.selected).toBe(1);
    expect(result.deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(state.records).toHaveLength(1);
  });

  it("apply mode deletes exactly the eligible records and keeps recent ones", async () => {
    const { client, state } = makeStatefulClient([
      { key: "old", createdAt: at(-100) },
      { key: "recent", createdAt: at(1) },
    ]);

    const result = await purgeExpiredIdempotencyRecords({
      mode: "apply",
      client,
      now: at(48),
    });

    expect(result.selected).toBe(1);
    expect(result.deleted).toBe(1);
    expect(state.records.map((record) => record.key)).toEqual(["recent"]);
  });

  it("is safe to run repeatedly", async () => {
    const { client, state, deleteMany } = makeStatefulClient([
      { key: "old-1", createdAt: at(-70) },
      { key: "old-2", createdAt: at(-60) },
      { key: "recent", createdAt: at(1) },
    ]);

    const first = await purgeExpiredIdempotencyRecords({
      mode: "apply",
      client,
      now: at(48),
    });
    const second = await purgeExpiredIdempotencyRecords({
      mode: "apply",
      client,
      now: at(48),
    });

    expect(first.deleted).toBe(2);
    expect(second.selected).toBe(0);
    expect(second.deleted).toBe(0);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(state.records.map((record) => record.key)).toEqual(["recent"]);
  });

  it("is safe to run concurrently", async () => {
    const { client, state } = makeStatefulClient([
      { key: "old-1", createdAt: at(-70) },
      { key: "old-2", createdAt: at(-60) },
      { key: "recent", createdAt: at(1) },
    ]);

    const [first, second] = await Promise.all([
      purgeExpiredIdempotencyRecords({ mode: "apply", client, now: at(48) }),
      purgeExpiredIdempotencyRecords({ mode: "apply", client, now: at(48) }),
    ]);

    // Every eligible record is deleted at most once across both runs.
    expect(first.deleted + second.deleted).toBe(2);
    expect(state.records.map((record) => record.key)).toEqual(["recent"]);
  });

  it("rejects retention windows that could outrun the seven-day duplicate protection", async () => {
    const { client } = makeStatefulClient([]);

    for (const retentionHours of [0, -1, 1.5, 168, 1000]) {
      await expect(
        purgeExpiredIdempotencyRecords({
          mode: "preview",
          client,
          retentionHours,
          now: at(48),
        }),
      ).rejects.toThrow(/seven-day duplicate-mobile/);
    }
  });

  it("rejects invalid limits and modes", async () => {
    const { client } = makeStatefulClient([]);

    for (const limit of [0, -5, 10001, 2.5]) {
      await expect(
        purgeExpiredIdempotencyRecords({ mode: "preview", client, limit, now: at(48) }),
      ).rejects.toThrow(/limit/);
    }

    await expect(
      purgeExpiredIdempotencyRecords({
        mode: "destroy" as never,
        client,
        now: at(48),
      }),
    ).rejects.toThrow(/mode/);
  });

  it("propagates selection failures without deleting anything", async () => {
    const failure = new Error("connection terminated");
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const client: RetentionClient = {
      idempotencyRecord: {
        findMany: vi.fn(async () => {
          throw failure;
        }),
        deleteMany,
      },
    };

    await expect(
      purgeExpiredIdempotencyRecords({ mode: "apply", client, now: at(48) }),
    ).rejects.toThrow("connection terminated");
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("propagates deletion failures without corrupting stored records", async () => {
    const failure = new Error("connection terminated");
    const state: { records: StoredRecord[] } = {
      records: [{ key: "old", createdAt: at(-100) }],
    };
    const client: RetentionClient = {
      idempotencyRecord: {
        findMany: vi.fn(async () =>
          state.records.map((record) => ({
            key: record.key,
            createdAt: record.createdAt,
          })),
        ),
        deleteMany: vi.fn(async () => {
          throw failure;
        }),
      },
    };

    await expect(
      purgeExpiredIdempotencyRecords({ mode: "apply", client, now: at(48) }),
    ).rejects.toThrow("connection terminated");
    // The failed cleanup left the stored record untouched.
    expect(state.records.map((record) => record.key)).toEqual(["old"]);
  });
});
