import { confirmApplication } from "./services/assistant-confirmation.js";
import { runGroqAssistant } from "./services/groq-assistant.js";
﻿import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { prisma } from "./lib/prisma.js";
import {
  calculateQuote,
  QuoteValidationError,
  type Karat,
  type LoanScheme,
} from "./domain/loan-calculator.js";

const app = express();

app.use(helmet());

const configuredOrigins = (process.env.WEB_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const localDevelopmentOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
      ];

const allowedOrigins = new Set([
  ...configuredOrigins,
  ...localDevelopmentOrigins,
]);

app.use(cors({
  origin(origin, callback) {
    // Non-browser clients and same-origin requests may omit Origin.
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
}));

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


const quoteSchema = z.object({
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



function toCalculatorScheme(scheme: {
  id: string;
  name: string;
  interestRatePercent: { toString(): string };
  maxLtv: { toString(): string };
  tenureMonths: number;
  repaymentType: string;
}): LoanScheme {
  if (scheme.repaymentType !== "BULLET" && scheme.repaymentType !== "EMI") {
    throw new Error("Invalid repayment type configured for loan scheme");
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


const assistantChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(["user", "model"]),
    text: z.string().max(4000),
  }).strict()).max(12).optional(),
}).strict();

const assistantConfirmSchema = z.object({
  confirmationToken: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();

app.post("/api/v1/assistant/chat", async (req, res, next) => {
  const parsed = assistantChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Provide a message and valid conversation history.",
    });
  }

  try {
    const result = await runGroqAssistant(
      parsed.data.message,
      parsed.data.history ?? [],
    );
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/assistant/confirm", async (req, res, next) => {
  const parsed = assistantConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "CONFIRMATION_REQUIRED",
      message: "A valid confirmation token and explicit confirmation are required.",
    });
  }

  try {
    const result = await confirmApplication(
      parsed.data.confirmationToken,
      parsed.data.confirmed,
    );

    if (result.kind === "NOT_CONFIRMED") {
      return res.status(400).json({ error: "NOT_CONFIRMED" });
    }

    if (result.kind === "EXPIRED_OR_INVALID") {
      return res.status(410).json({
        error: "CONFIRMATION_EXPIRED",
        message: "Please prepare the application again.",
      });
    }

    if (result.kind === "SCHEME_NOT_FOUND") {
      return res.status(404).json({ error: "SCHEME_NOT_FOUND" });
    }

    if (result.kind === "DUPLICATE") {
      return res.status(409).json({
        error: "DUPLICATE_APPLICATION",
        message: "An application already exists for this mobile number within the last 7 days.",
        existingApplicationId: result.existingApplicationId,
      });
    }

    return res.status(201).json({
      message: "Application submitted successfully",
      application: result.application,
    });
  } catch (error) {
    next(error);
  }
});

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
  const parsed = validateBody(quoteSchema, req.body);

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

    const quote = calculateQuote(
      {
        netWeightGrams: parsed.data.netWeightGrams,
        grossWeightGrams: parsed.data.grossWeightGrams,
        karat: parsed.data.karat,
        schemeId: parsed.data.schemeId,
      },
      toCalculatorScheme(scheme),
    );

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

    const quote = calculateQuote(
      {
        netWeightGrams: input.netWeightGrams,
        grossWeightGrams: input.grossWeightGrams,
        karat: input.karat,
        schemeId: input.schemeId,
      },
      toCalculatorScheme(scheme),
    );

    const created = await prisma.$transaction(async (tx) => {
      // Serialize submissions for the same mobile number within PostgreSQL.
      await tx.$queryRaw<{ locked: number }[]>`
        WITH acquired AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtext(${input.mobile}))
        )
        SELECT 1 AS locked FROM acquired
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





