import { prisma } from "../lib/prisma.js";

// Forty-eight hours sits well inside the seven-day duplicate-mobile window:
// a successful lead and its idempotency record are created in the same
// transaction and share the same database timestamp, so when a record becomes
// eligible for cleanup the lead is still younger than seven days. A
// post-cleanup retry of the same payload within seven days of the original
// submission therefore re-executes and is stopped by the duplicate-mobile
// check instead of creating a second lead; a retry later than that follows
// the normal seven-day rule, exactly like any same-mobile resubmission. The
// window is hard-capped below 168 hours so the seven-day argument can never
// be invalidated by configuration.
export const DEFAULT_RETENTION_HOURS = 48;
export const MAX_RETENTION_HOURS = 167;
export const DEFAULT_PURGE_LIMIT = 1000;
export const MAX_PURGE_LIMIT = 10000;

const HOUR_MS = 60 * 60 * 1000;
const SAMPLE_KEY_COUNT = 5;

export type PurgeMode = "preview" | "apply";

export type PurgeResult = {
  mode: PurgeMode;
  cutoff: Date;
  limit: number;
  selected: number;
  deleted: number;
  sampleKeys: string[];
};

// Structural subset of the Prisma client used by retention cleanup. Method
// syntax keeps it assignable from the generated client and from test doubles.
export interface RetentionClient {
  idempotencyRecord: {
    findMany(args: {
      where: { createdAt: { lt: Date } };
      orderBy: { createdAt: "asc" };
      take: number;
      select: { key: true; createdAt: true };
    }): Promise<Array<{ key: string; createdAt: Date }>>;
    deleteMany(args: {
      where: { key: { in: string[] }; createdAt: { lt: Date } };
    }): Promise<{ count: number }>;
  };
}

export async function purgeExpiredIdempotencyRecords(options: {
  mode: PurgeMode;
  client?: RetentionClient;
  retentionHours?: number;
  limit?: number;
  now?: Date;
}): Promise<PurgeResult> {
  const {
    mode,
    client = prisma,
    retentionHours = DEFAULT_RETENTION_HOURS,
    limit = DEFAULT_PURGE_LIMIT,
    now = new Date(),
  } = options;

  if (
    !Number.isInteger(retentionHours) ||
    retentionHours < 1 ||
    retentionHours > MAX_RETENTION_HOURS
  ) {
    throw new Error(
      `retentionHours must be an integer between 1 and ${MAX_RETENTION_HOURS} so that cleanup can never outrun the seven-day duplicate-mobile protection`,
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PURGE_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_PURGE_LIMIT}`);
  }

  if (mode !== "preview" && mode !== "apply") {
    throw new Error(`mode must be "preview" or "apply"`);
  }

  const cutoff = new Date(now.getTime() - retentionHours * HOUR_MS);

  const candidates = await client.idempotencyRecord.findMany({
    where: { createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { key: true, createdAt: true },
  });

  const sampleKeys = candidates
    .slice(0, SAMPLE_KEY_COUNT)
    .map((record) => record.key);

  if (mode === "preview" || candidates.length === 0) {
    return {
      mode,
      cutoff,
      limit,
      selected: candidates.length,
      deleted: 0,
      sampleKeys,
    };
  }

  // The cutoff is re-applied inside the delete as defense in depth so the
  // statement can only ever remove rows from the reviewed selection window.
  const deletion = await client.idempotencyRecord.deleteMany({
    where: {
      key: { in: candidates.map((record) => record.key) },
      createdAt: { lt: cutoff },
    },
  });

  return {
    mode,
    cutoff,
    limit,
    selected: candidates.length,
    deleted: deletion.count,
    sampleKeys,
  };
}
