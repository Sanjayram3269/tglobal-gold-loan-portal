import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  calculateQuote,
  type Karat,
  type LoanScheme,
} from "../domain/loan-calculator.js";

const draftSchema = z.object({
  name: z.string().trim().min(2).max(60).regex(/^[A-Za-z ]+$/),
  mobile: z.string().regex(/^[6-9]\d{9}$/),
  netWeightGrams: z.number().finite().gt(0).max(1000),
  grossWeightGrams: z.number().finite().gt(0).max(1000),
  karat: z.union([z.literal(18), z.literal(22), z.literal(24)]),
  schemeId: z.string().min(1),
}).strict().refine(
  (draft) => draft.netWeightGrams <= draft.grossWeightGrams,
  { message: "Net weight cannot exceed gross weight" },
);

export type ApplicationDraft = z.infer<typeof draftSchema>;

const pending = new Map<
  string,
  { draft: ApplicationDraft; expiresAt: number }
>();

const TTL_MS = 10 * 60 * 1000;

export function prepareApplication(rawDraft: unknown) {
  const draft = draftSchema.parse(rawDraft);
  const token = randomUUID();

  pending.set(token, {
    draft,
    expiresAt: Date.now() + TTL_MS,
  });

  return {
    confirmationToken: token,
    expiresInSeconds: TTL_MS / 1000,
    application: {
      name: draft.name,
      mobile: `${draft.mobile.slice(0, 4)}XXXX${draft.mobile.slice(-2)}`,
      netWeightGrams: draft.netWeightGrams,
      grossWeightGrams: draft.grossWeightGrams,
      karat: draft.karat,
      schemeId: draft.schemeId,
    },
  };
}

function toScheme(scheme: {
  id: string;
  name: string;
  interestRatePercent: { toString(): string };
  maxLtv: { toString(): string };
  tenureMonths: number;
  repaymentType: string;
}): LoanScheme {
  if (scheme.repaymentType !== "BULLET" && scheme.repaymentType !== "EMI") {
    throw new Error("Invalid repayment type configured");
  }

  return {
    id: scheme.id,
    name: scheme.name,
    interestRatePercent: scheme.interestRatePercent.toString(),
    maxLtv: scheme.maxLtv.toString(),
    tenureMonths: scheme.tenureMonths,
    repaymentType: scheme.repaymentType,
  };
}

export async function confirmApplication(token: string, confirmed: boolean) {
  if (confirmed !== true) {
    return { kind: "NOT_CONFIRMED" as const };
  }

  const item = pending.get(token);

  if (!item || item.expiresAt < Date.now()) {
    pending.delete(token);
    return { kind: "EXPIRED_OR_INVALID" as const };
  }

  // Consume the token before awaiting database operations to prevent replay.
  pending.delete(token);

  const draft = draftSchema.parse(item.draft);
  const scheme = await prisma.loanScheme.findUnique({
    where: { id: draft.schemeId },
  });

  if (!scheme) {
    return { kind: "SCHEME_NOT_FOUND" as const };
  }

  const quote = calculateQuote(
    {
      netWeightGrams: draft.netWeightGrams,
      grossWeightGrams: draft.grossWeightGrams,
      karat: draft.karat as Karat,
      schemeId: draft.schemeId,
    },
    toScheme(scheme),
  );

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      WITH acquired AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${draft.mobile}))
      )
      SELECT 1 AS lock_acquired FROM acquired
    `;

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const duplicate = await tx.lead.findFirst({
      where: {
        mobile: draft.mobile,
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (duplicate) {
      return { kind: "DUPLICATE" as const, id: duplicate.id };
    }

    const lead = await tx.lead.create({
      data: {
        name: draft.name,
        mobile: draft.mobile,
        netWeightGrams: draft.netWeightGrams,
        grossWeightGrams: draft.grossWeightGrams,
        karat: draft.karat,
        schemeId: draft.schemeId,
        eligibleLoanRupees: BigInt(quote.eligibleLoanRupees),
        status: "SUBMITTED",
      },
    });

    return { kind: "CREATED" as const, lead };
  });

  if (result.kind === "DUPLICATE") {
    return {
      kind: "DUPLICATE" as const,
      existingApplicationId: result.id,
    };
  }

  return {
    kind: "CREATED" as const,
    application: {
      id: result.lead.id,
      name: result.lead.name,
      mobile: `${result.lead.mobile.slice(0, 4)}XXXX${result.lead.mobile.slice(-2)}`,
      schemeId: result.lead.schemeId,
      eligibleLoanRupees: Number(result.lead.eligibleLoanRupees),
      status: result.lead.status,
      createdAt: result.lead.createdAt,
    },
  };
}
