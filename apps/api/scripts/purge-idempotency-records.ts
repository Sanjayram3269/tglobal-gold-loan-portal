// Explicit, opt-in maintenance command for lead idempotency retention.
// Runs in preview (dry-run) mode by default; pass --apply to delete records.
// This script is never invoked by the API server, startup code, or CI.
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import {
  DEFAULT_PURGE_LIMIT,
  DEFAULT_RETENTION_HOURS,
  purgeExpiredIdempotencyRecords,
} from "../src/services/idempotency-retention.js";

function parseIntegerFlag(argv: string[], name: string): number | undefined {
  const raw = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return undefined;

  const value = Number(raw.slice(name.length + 3));
  if (!Number.isInteger(value)) {
    throw new Error(`--${name} must be an integer`);
  }
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter(
    (arg) =>
      arg !== "--apply" &&
      !arg.startsWith("--older-than-hours=") &&
      !arg.startsWith("--limit="),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  }

  const apply = argv.includes("--apply");
  const retentionHours =
    parseIntegerFlag(argv, "older-than-hours") ?? DEFAULT_RETENTION_HOURS;
  const limit = parseIntegerFlag(argv, "limit") ?? DEFAULT_PURGE_LIMIT;

  const result = await purgeExpiredIdempotencyRecords({
    mode: apply ? "apply" : "preview",
    retentionHours,
    limit,
  });

  console.log(
    `Mode: ${apply ? "apply" : "preview (dry run, no rows deleted)"}`,
  );
  console.log(
    `Retention: ${retentionHours}h - records created before ${result.cutoff.toISOString()} are eligible`,
  );
  console.log(
    `Selected (bounded by limit ${result.limit}): ${result.selected}`,
  );
  console.log(`Deleted: ${result.deleted}`);
  if (result.sampleKeys.length > 0) {
    console.log(`Sample eligible keys: ${result.sampleKeys.join(", ")}`);
  }
  if (!apply && result.selected > 0) {
    console.log("Re-run with --apply to delete the selected records.");
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      "Idempotency retention cleanup failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
