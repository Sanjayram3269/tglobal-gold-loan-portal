import { confirmApplication } from "./services/assistant-confirmation.js";
import { runGroqAssistant } from "./services/groq-assistant.js";
﻿import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { z } from "zod";
import { createHash } from "node:crypto";
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
    if (!origin || allowedOrigins.has(origin)) {
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

function errorBody(
  code: string,
  message: string,
  fields: Array<{ field: string; message: string }> = [],
  extra: Record<string, unknown> = {},
) {
  return {
    error: { code, message, fields },
    message,
    details: fields,
    ...extra,
  };
}

function apiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  fields: Array<{ field: string; message: string }> = [],
  extra: Record<string, unknown> = {},
) {
  return res.status(status).json(errorBody(code, message, fields, extra));
}

function validationResponse(res: Response, errors: unknown[]) {
  return apiError(
    res,
    400,
    "VALIDATION_ERROR",
    "Please correct the submitted fields",
    errors as Array<{ field: string; message: string }>,
  );
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]+$/;
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
const IDEMPOTENCY_REUSED_MESSAGE =
  "This Idempotency-Key was already used with a different request payload.";

type IdempotencyKeyCheck =
  | { kind: "absent" }
  | { kind: "invalid"; message: string }
  | { kind: "valid"; key: string };

function readIdempotencyKey(req: Request): IdempotencyKeyCheck {
  const raw = req.get("Idempotency-Key");

  if (raw === undefined) return { kind: "absent" };

  if (
    raw.length === 0 ||
    raw.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(raw)
  ) {
    return {
      kind: "invalid",
      message: `Idempotency-Key must be 1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters long and use only letters, digits, and the characters . _ ~ : -`,
    };
  }

  return { kind: "valid", key: raw };
}

// Canonical fingerprint of the validated request, so semantically equivalent
// payloads (for example coerced weights or reordered keys) map to one value.
function canonicalFingerprint(input: ApplicationInput): string {
  const canonical = Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  );

  return createHash("sha256")
    .update(`POST /api/v1/leads:${JSON.stringify(canonical)}`)
    .digest("hex");
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

type IdempotencyRecordSnapshot = {
  fingerprint: string;
  responseStatus: number;
  responseBody: string;
};

type IdempotencyOutcome =
  | { kind: "replay"; status: number; body: string }
  | { kind: "conflict" };

function idempotencyOutcome(
  record: IdempotencyRecordSnapshot,
  fingerprint: string,
): IdempotencyOutcome {
  if (record.fingerprint !== fingerprint) return { kind: "conflict" };

  return {
    kind: "replay",
    status: record.responseStatus,
    body: record.responseBody,
  };
}

function sendIdempotencyOutcome(res: Response, outcome: IdempotencyOutcome) {
  if (outcome.kind === "conflict") {
    return apiError(res, 409, "IDEMPOTENCY_KEY_REUSED", IDEMPOTENCY_REUSED_MESSAGE);
  }

  res.setHeader("Idempotency-Replayed", "true");
  res.status(outcome.status);
  res.type("application/json");
  return res.send(outcome.body);
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
    return apiError(res, 400, "VALIDATION_ERROR", "Provide a message and valid conversation history.");
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
    return apiError(res, 400, "CONFIRMATION_REQUIRED", "A valid confirmation token and explicit confirmation are required.");
  }

  try {
    const result = await confirmApplication(
      parsed.data.confirmationToken,
      parsed.data.confirmed,
    );

    if (result.kind === "NOT_CONFIRMED") {
      return apiError(res, 400, "NOT_CONFIRMED", "Explicit confirmation is required.");
    }

    if (result.kind === "EXPIRED_OR_INVALID") {
      return apiError(res, 410, "CONFIRMATION_EXPIRED", "Please prepare the application again.");
    }

    if (result.kind === "SCHEME_NOT_FOUND") {
      return apiError(res, 404, "SCHEME_NOT_FOUND", "The selected loan scheme was not found.");
    }

    if (result.kind === "DUPLICATE") {
      return apiError(res, 409, "DUPLICATE_APPLICATION", "An application already exists for this mobile number within the last 7 days.", [], { existingApplicationId: result.existingApplicationId });
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
      return apiError(res, 404, "SCHEME_NOT_FOUND", "The selected loan scheme was not found.");
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
  const keyCheck = readIdempotencyKey(req);

  if (keyCheck.kind === "invalid") {
    return apiError(res, 400, "IDEMPOTENCY_KEY_INVALID", keyCheck.message);
  }

  const parsed = validateBody(applicationSchema, req.body);

  if (!parsed.success) return validationResponse(res, parsed.errors);

  const input: ApplicationInput = parsed.data;
  const idempotencyKey = keyCheck.kind === "valid" ? keyCheck.key : null;
  const fingerprint = idempotencyKey ? canonicalFingerprint(input) : null;

  try {
    // Fast path: a committed record means the original request already
    // finished, so replay its exact status and body without further work.
    if (idempotencyKey && fingerprint) {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key: idempotencyKey },
      });

      if (existing) {
        return sendIdempotencyOutcome(res, idempotencyOutcome(existing, fingerprint));
      }
    }

    const outcome = await prisma.$transaction(async (tx) => {
      // Serialize submissions for the same mobile number within PostgreSQL.
      await tx.$queryRaw<{ locked: number }[]>`
        WITH acquired AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtext(${input.mobile}))
        )
        SELECT 1 AS locked FROM acquired
      `;

      // A committed record for this key that becomes visible here means a
      // concurrent request with the same mobile number finished first.
      if (idempotencyKey && fingerprint) {
        const existing = await tx.idempotencyRecord.findUnique({
          where: { key: idempotencyKey },
        });

        if (existing) return idempotencyOutcome(existing, fingerprint);
      }

      const scheme = await tx.loanScheme.findUnique({
        where: { id: input.schemeId },
      });

      if (!scheme) {
        const body = errorBody("SCHEME_NOT_FOUND", "The selected loan scheme was not found.");

        if (idempotencyKey && fingerprint) {
          await tx.idempotencyRecord.create({
            data: {
              key: idempotencyKey,
              fingerprint,
              responseStatus: 404,
              responseBody: JSON.stringify(body),
            },
          });
        }

        return { kind: "respond", status: 404, body } as const;
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
        const body = errorBody(
          "DUPLICATE_APPLICATION",
          "An application was already submitted with this mobile number in the last 7 days.",
          [],
          { existingApplicationId: duplicate.id },
        );

        if (idempotencyKey && fingerprint) {
          await tx.idempotencyRecord.create({
            data: {
              key: idempotencyKey,
              fingerprint,
              responseStatus: 409,
              responseBody: JSON.stringify(body),
            },
          });
        }

        return { kind: "respond", status: 409, body } as const;
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

      const body = {
        message: "Application submitted successfully",
        application: {
          id: lead.id,
          name: lead.name,
          mobile: maskMobile(lead.mobile),
          schemeId: lead.schemeId,
          eligibleLoanRupees: Number(lead.eligibleLoanRupees),
          status: lead.status,
          createdAt: lead.createdAt,
        },
      };

      // The lead and its idempotency result commit atomically: a failure can
      // never persist one without the other.
      if (idempotencyKey && fingerprint) {
        await tx.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            fingerprint,
            responseStatus: 201,
            responseBody: JSON.stringify(body),
          },
        });
      }

      return { kind: "respond", status: 201, body } as const;
    });

    if (outcome.kind !== "respond") {
      return sendIdempotencyOutcome(res, outcome);
    }

    return res.status(outcome.status).json(outcome.body);
  } catch (error) {
    // A concurrent request with the same key committed first, so PostgreSQL
    // rejected our insert: replay the stored result or report key reuse.
    if (idempotencyKey && fingerprint && isUniqueConstraintViolation(error)) {
      try {
        const existing = await prisma.idempotencyRecord.findUnique({
          where: { key: idempotencyKey },
        });

        if (existing) {
          return sendIdempotencyOutcome(res, idempotencyOutcome(existing, fingerprint));
        }
      } catch (replayError) {
        return next(replayError);
      }
    }

    return next(error);
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
  apiError(res, 404, "NOT_FOUND", "Endpoint not found");
});

app.use((
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (error instanceof QuoteValidationError) {
    return apiError(
      res,
      error.statusCode,
      error.statusCode === 404 ? "SCHEME_NOT_FOUND" : "VALIDATION_ERROR",
      error.message,
      error.field ? [{ field: error.field, message: error.message }] : [],
    );
  }

  if (error instanceof SyntaxError && "body" in error) {
    return apiError(res, 400, "INVALID_JSON", "Request body contains invalid JSON");
  }

  console.error(error);
  return apiError(res, 500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred");
});

export default app;





