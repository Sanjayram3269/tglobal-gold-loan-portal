import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { prisma } from "./lib/prisma.js";
import {
  calculateQuote,
  LOAN_SCHEMES,
  QuoteValidationError,
  type Karat,
} from "./domain/loan-calculator.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "32kb" }));

const applicationSchema = z.object({
  name: z.string().trim().min(2).max(60).regex(/^[A-Za-z ]+$/, {
    message: "Name must contain only letters and spaces",
  }),
  mobile: z.string().regex(/^[6-9]\d{9}$/, {
    message: "Enter a valid 10-digit Indian mobile number",
  }),
  netWeightGrams: z.coerce.number().finite().gt(0).max(1000),
  grossWeightGrams: z.coerce.number().finite().gt(0).max(1000),
  karat: z.union([z.literal(18), z.literal(22), z.literal(24)]),
  schemeId: z.string().min(1),
}).strict().superRefine((data, ctx) => {
  if (data.netWeightGrams > data.grossWeightGrams) {
    ctx.addIssue({
      code: "custom",
      path: ["netWeightGrams"],
      message: "Net weight cannot exceed gross weight",
    });
  }
});

type ApplicationInput = z.infer<typeof applicationSchema>;

function maskMobile(mobile: string): string {
  return `${mobile.slice(0, 4)}XXXX${mobile.slice(-2)}`;
}

function validateBody<T>(schema: z.ZodType<T>, body: unknown) {
  const result = schema.safeParse(body);

  if (result.success) return { success: true as const, data: result.data };

  return {
    success: false as const,
    errors: result.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function validationResponse(res: Response, errors: unknown[]) {
  return res.status(400).json({
    error: "VALIDATION_ERROR",
    message: "Please correct the submitted fields",
    details: errors,
  });
}

app.get("/health", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/loan-schemes", async (_req, res, next) => {
  try {
    const schemes = await prisma.loanScheme.findMany({
      orderBy: { id: "asc" },
    });

    res.json({
      schemes: schemes.map((scheme) => ({
        id: scheme.id,
        name: scheme.name,
        interestRatePercent: scheme.interestRatePercent.toString(),
        maxLtv: scheme.maxLtv.toString(),
        tenureMonths: scheme.tenureMonths,
        repaymentType: scheme.repaymentType,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/quotes", async (req, res, next) => {
  const parsed = validateBody(applicationSchema, req.body);

  if (!parsed.success) return validationResponse(res, parsed.errors);

  try {
    const scheme = await prisma.loanScheme.findUnique({
      where: { id: parsed.data.schemeId },
    });

    if (!scheme) {
      return res.status(404).json({
        error: "SCHEME_NOT_FOUND",
        message: "The selected loan scheme was not found",
      });
    }

    const quote = calculateQuote({
      netWeightGrams: parsed.data.netWeightGrams,
      grossWeightGrams: parsed.data.grossWeightGrams,
      karat: parsed.data.karat,
      schemeId: parsed.data.schemeId,
    });

    return res.json({ quote });
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/leads", async (req, res, next) => {
  const parsed = validateBody(applicationSchema, req.body);

  if (!parsed.success) return validationResponse(res, parsed.errors);

  const input: ApplicationInput = parsed.data;

  try {
    const scheme = await prisma.loanScheme.findUnique({
      where: { id: input.schemeId },
    });

    if (!scheme) {
      return res.status(404).json({
        error: "SCHEME_NOT_FOUND",
        message: "The selected loan scheme was not found",
      });
    }

    const quote = calculateQuote({
      netWeightGrams: input.netWeightGrams,
      grossWeightGrams: input.grossWeightGrams,
      karat: input.karat,
      schemeId: input.schemeId,
    });

    const created = await prisma.$transaction(async (tx) => {
      // Serialize submissions for the same mobile number within PostgreSQL.
      await tx.$queryRaw<{ locked: number }[]>`
        SELECT 1 AS locked
        FROM (
          SELECT pg_advisory_xact_lock(hashtext(${input.mobile}))
        ) AS lock_result
      `;

      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const duplicate = await tx.lead.findFirst({
        where: {
          mobile: input.mobile,
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (duplicate) {
        return { duplicateId: duplicate.id } as const;
      }

      const lead = await tx.lead.create({
        data: {
          name: input.name,
          mobile: input.mobile,
          netWeightGrams: input.netWeightGrams,
          grossWeightGrams: input.grossWeightGrams,
          karat: input.karat,
          schemeId: input.schemeId,
          eligibleLoanRupees: BigInt(quote.eligibleLoanRupees),
          status: "SUBMITTED",
        },
      });

      return { lead } as const;
    });

    if ("duplicateId" in created) {
      return res.status(409).json({
        error: "DUPLICATE_APPLICATION",
        message: "An application was already submitted with this mobile number in the last 7 days",
        existingApplicationId: created.duplicateId,
      });
    }

    return res.status(201).json({
      message: "Application submitted successfully",
      application: {
        id: created.lead.id,
        name: created.lead.name,
        mobile: maskMobile(created.lead.mobile),
        schemeId: created.lead.schemeId,
        eligibleLoanRupees: Number(created.lead.eligibleLoanRupees),
        status: created.lead.status,
        createdAt: created.lead.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/leads", async (_req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        mobile: true,
        netWeightGrams: true,
        grossWeightGrams: true,
        karat: true,
        schemeId: true,
        eligibleLoanRupees: true,
        status: true,
        createdAt: true,
      },
    });

    return res.json({
      leads: leads.map((lead) => ({
        ...lead,
        mobile: maskMobile(lead.mobile),
        netWeightGrams: Number(lead.netWeightGrams),
        grossWeightGrams: Number(lead.grossWeightGrams),
        eligibleLoanRupees: Number(lead.eligibleLoanRupees),
      })),
      total: leads.length,
    });
  } catch (error) {
    next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: "Endpoint not found",
  });
});

app.use((
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (error instanceof QuoteValidationError) {
    return res.status(error.statusCode).json({
      error: error.statusCode === 404 ? "SCHEME_NOT_FOUND" : "VALIDATION_ERROR",
      message: error.message,
      field: error.field,
    });
  }

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      error: "INVALID_JSON",
      message: "Request body contains invalid JSON",
    });
  }

  console.error(error);
  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
  });
});

export default app;
