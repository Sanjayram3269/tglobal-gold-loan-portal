import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { prismaMock, assistantMock, confirmationMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    loanScheme: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    idempotencyRecord: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
  assistantMock: {
    runGroqAssistant: vi.fn(),
  },
  confirmationMock: {
    confirmApplication: vi.fn(),
  },
}));

vi.mock("../src/lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/groq-assistant.js", () => assistantMock);
vi.mock("../src/services/assistant-confirmation.js", () => confirmationMock);

import app from "../src/app.js";

const emiScheme = {
  id: "PLAN_EMI_01",
  name: "Monthly EMI",
  interestRatePercent: { toString: () => "10.50" },
  maxLtv: { toString: () => "0.750" },
  tenureMonths: 12,
  repaymentType: "EMI",
};

const bulletScheme = {
  id: "PLAN_BULLET_01",
  name: "Bullet Repayment",
  interestRatePercent: { toString: () => "12.00" },
  maxLtv: { toString: () => "0.700" },
  tenureMonths: 12,
  repaymentType: "BULLET",
};

const validQuote = {
  netWeightGrams: 45,
  grossWeightGrams: 50,
  karat: 22,
  schemeId: "PLAN_EMI_01",
};

const validApplication = {
  name: "Test Applicant",
  mobile: "9876543210",
  ...validQuote,
};

const tx = {
  $queryRaw: vi.fn(),
  loanScheme: {
    findUnique: vi.fn(),
  },
  lead: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  idempotencyRecord: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
};

type IdempotencyCreateData = {
  key: string;
  fingerprint: string;
  responseStatus: number;
  responseBody: string;
};

const createdLead = {
  id: "lead-test-001",
  name: "Test Applicant",
  mobile: "9876543210",
  netWeightGrams: 45,
  grossWeightGrams: 50,
  karat: 22,
  schemeId: "PLAN_EMI_01",
  eligibleLoanRupees: 216562n,
  status: "SUBMITTED",
  createdAt: new Date("2026-10-09T12:00:00.000Z"),
};

async function resolveScheme({ where }: { where: { id: string } }) {
  return where.id === emiScheme.id
    ? emiScheme
    : where.id === bulletScheme.id
      ? bulletScheme
      : null;
}

describe("HTTP API", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$queryRaw.mockResolvedValue([{ result: 1 }]);
    prismaMock.loanScheme.findMany.mockResolvedValue([bulletScheme, emiScheme]);
    prismaMock.loanScheme.findUnique.mockImplementation(resolveScheme);

    prismaMock.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ locked: 1 }]);
    tx.loanScheme.findUnique.mockImplementation(resolveScheme);
    tx.lead.findFirst.mockResolvedValue(null);
    tx.lead.create.mockResolvedValue(createdLead);
    tx.idempotencyRecord.findUnique.mockResolvedValue(null);
    tx.idempotencyRecord.create.mockImplementation(
      async ({ data }: { data: IdempotencyCreateData }) => ({
        ...data,
        createdAt: new Date("2026-10-10T12:00:00.000Z"),
        updatedAt: new Date("2026-10-10T12:00:00.000Z"),
      }),
    );

    prismaMock.lead.findMany.mockResolvedValue([createdLead]);
    prismaMock.lead.findFirst.mockResolvedValue(null);
    prismaMock.lead.create.mockResolvedValue(createdLead);
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue(null);
    prismaMock.idempotencyRecord.create.mockResolvedValue(null);

    assistantMock.runGroqAssistant.mockResolvedValue({
      reply: "I can help with gold loan schemes.",
      pendingApplication: null,
      toolCalls: [],
    });
    confirmationMock.confirmApplication.mockResolvedValue({
      kind: "EXPIRED_OR_INVALID",
    });
  });

  it("returns a healthy database status", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "connected" });
  });

  it("lists active loan schemes", async () => {
    const response = await request(app).get("/api/v1/loan-schemes");
    expect(response.status).toBe(200);
    expect(response.body.schemes).toHaveLength(2);
    expect(response.body.schemes[0]).toMatchObject({
      id: "PLAN_BULLET_01",
      name: "Bullet Repayment",
      interestRatePercent: "12.00",
    });
  });

  it("returns the expected quote without creating a lead", async () => {
    const response = await request(app)
      .post("/api/v1/quotes")
      .send(validQuote);

    expect(response.status).toBe(200);
    expect(response.body.quote).toMatchObject({
      pureGoldGrams: "41.25",
      goldValueRupees: 288750,
      eligibleLoanRupees: 216562,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.lead.create).not.toHaveBeenCalled();
  });

  it("returns field-level validation errors for invalid weights", async () => {
    const response = await request(app)
      .post("/api/v1/quotes")
      .send({ ...validQuote, netWeightGrams: 60 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR", fields: expect.any(Array) });
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "netWeightGrams",
          message: "Net weight cannot exceed gross weight",
        }),
      ]),
    );
  });

  it("returns 404 for an unknown scheme", async () => {
    const response = await request(app)
      .post("/api/v1/quotes")
      .send({ ...validQuote, schemeId: "PLAN_UNKNOWN" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SCHEME_NOT_FOUND");
  });

  it("creates an application using the server-computed amount and masks mobile", async () => {
    const response = await request(app)
      .post("/api/v1/leads")
      .send(validApplication);

    expect(response.status).toBe(201);
    expect(response.body.application).toMatchObject({
      id: "lead-test-001",
      mobile: "9876XXXX10",
      eligibleLoanRupees: 216562,
      status: "SUBMITTED",
    });
    expect(tx.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eligibleLoanRupees: 216562n,
        }),
      }),
    );
  });

  it("rejects a duplicate application within the duplicate-check window", async () => {
    tx.lead.findFirst.mockResolvedValueOnce({ id: "existing-lead-001" });

    const response = await request(app)
      .post("/api/v1/leads")
      .send(validApplication);

    expect(response.status).toBe(409);
    expect(response.body.existingApplicationId).toBe("existing-lead-001");
    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it("lists leads newest first and masks mobile numbers", async () => {
    prismaMock.lead.findMany.mockResolvedValueOnce([
      { ...createdLead, id: "newer", createdAt: new Date("2026-10-09T12:00:00Z") },
      { ...createdLead, id: "older", createdAt: new Date("2026-10-08T12:00:00Z") },
    ]);

    const response = await request(app).get("/api/v1/leads");

    expect(response.status).toBe(200);
    expect(response.body.leads.map((lead: { id: string }) => lead.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(response.body.leads[0].mobile).toBe("9876XXXX10");
    expect(response.body.leads[0].mobile).not.toBe("9876543210");
  });

  it("rejects assistant chat payloads that fail validation", async () => {
    const response = await request(app)
      .post("/api/v1/assistant/chat")
      .send({ message: "  " });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(assistantMock.runGroqAssistant).not.toHaveBeenCalled();
  });

  it("returns a sanitized not-found response for unknown endpoints", async () => {
    const response = await request(app).get("/api/v1/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  describe("idempotency for POST /api/v1/leads", () => {
    const idempotencyKey = "lead-request-0001";

    function stubCommittedRecord() {
      const state: { record: any } = { record: null };

      prismaMock.idempotencyRecord.findUnique.mockImplementation(
        async () => state.record,
      );
      tx.idempotencyRecord.create.mockImplementation(
        async ({ data }: { data: IdempotencyCreateData }) => {
          state.record = {
            ...data,
            createdAt: new Date("2026-10-10T12:00:00.000Z"),
            updatedAt: new Date("2026-10-10T12:00:00.000Z"),
          };
          return state.record;
        },
      );

      return state;
    }

    it("rejects an invalid idempotency key with a clear 400", async () => {
      const response = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", "bad key with spaces!")
        .send(validApplication);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_INVALID");
      expect(tx.lead.create).not.toHaveBeenCalled();
      expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
    });

    it("rejects an idempotency key longer than 255 characters", async () => {
      const response = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", "k".repeat(256))
        .send(validApplication);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_INVALID");
      expect(tx.lead.create).not.toHaveBeenCalled();
    });

    it("replays the original response for an equivalent retry without a second lead", async () => {
      const state = stubCommittedRecord();

      const first = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(first.status).toBe(201);
      expect(state.record).toMatchObject({
        key: idempotencyKey,
        responseStatus: 201,
        responseBody: expect.any(String),
      });
      expect(state.record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(state.record.responseBody).toContain("9876XXXX10");
      expect(state.record.responseBody).not.toContain("9876543210");
      expect(tx.lead.create).toHaveBeenCalledTimes(1);

      const replay = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(replay.status).toBe(201);
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      expect(replay.body).toEqual(first.body);
      expect(tx.lead.create).toHaveBeenCalledTimes(1);
      expect(tx.loanScheme.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.idempotencyRecord.findUnique).toHaveBeenCalledTimes(2);
    });

    it("returns 409 IDEMPOTENCY_KEY_REUSED when the key carries a different payload", async () => {
      const state = stubCommittedRecord();

      const first = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(first.status).toBe(201);

      const conflicting = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send({ ...validApplication, name: "Different Applicant" });

      expect(conflicting.status).toBe(409);
      expect(conflicting.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(state.record.responseStatus).toBe(201);
      expect(tx.lead.create).toHaveBeenCalledTimes(1);
    });

    it("keeps the seven-day duplicate-mobile check active with an idempotency key", async () => {
      const state = stubCommittedRecord();
      tx.lead.findFirst.mockResolvedValue({ id: "existing-lead-001" });

      const first = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(first.status).toBe(409);
      expect(first.body.error.code).toBe("DUPLICATE_APPLICATION");
      expect(first.body.existingApplicationId).toBe("existing-lead-001");
      expect(tx.lead.create).not.toHaveBeenCalled();
      expect(state.record).toMatchObject({ key: idempotencyKey, responseStatus: 409 });

      const replay = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(replay.status).toBe(409);
      expect(replay.body).toEqual(first.body);
      expect(tx.lead.findFirst).toHaveBeenCalledTimes(1);
    });

    it("persists and replays an unknown-scheme 404 under the same key", async () => {
      const state = stubCommittedRecord();
      const payload = { ...validApplication, schemeId: "PLAN_UNKNOWN" };

      const first = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(payload);

      expect(first.status).toBe(404);
      expect(first.body.error.code).toBe("SCHEME_NOT_FOUND");
      expect(state.record).toMatchObject({ key: idempotencyKey, responseStatus: 404 });
      expect(tx.lead.create).not.toHaveBeenCalled();

      const replay = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(payload);

      expect(replay.status).toBe(404);
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      expect(replay.body).toEqual(first.body);
      expect(tx.loanScheme.findUnique).toHaveBeenCalledTimes(1);
    });

    it("preserves existing behavior when no idempotency key is supplied", async () => {
      const response = await request(app).post("/api/v1/leads").send(validApplication);

      expect(response.status).toBe(201);
      expect(response.headers["idempotency-replayed"]).toBeUndefined();
      expect(prismaMock.idempotencyRecord.findUnique).not.toHaveBeenCalled();
      expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
      expect(tx.lead.create).toHaveBeenCalledTimes(1);
    });

    it("returns 500 and persists no record when the idempotency write fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const state = stubCommittedRecord();
      tx.idempotencyRecord.create.mockRejectedValueOnce(new Error("database unavailable"));

      const failed = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(failed.status).toBe(500);
      expect(failed.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(state.record).toBeNull();
      expect(consoleError).toHaveBeenCalled();

      const retry = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(retry.status).toBe(201);
      expect(state.record).toMatchObject({ key: idempotencyKey, responseStatus: 201 });
      consoleError.mockRestore();
    });

    it("does not write an idempotency record when the lead write fails", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      tx.lead.create.mockRejectedValueOnce(new Error("database unavailable"));

      const failed = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", idempotencyKey)
        .send(validApplication);

      expect(failed.status).toBe(500);
      expect(failed.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it("serves concurrent duplicate-key requests from a single committed record", async () => {
      const state: { record: any } = { record: null };
      let reads = 0;
      let successfulCreates = 0;

      // Both requests read before either transaction has committed, then the
      // losing insert hits the primary-key uniqueness constraint.
      prismaMock.idempotencyRecord.findUnique.mockImplementation(async () => {
        reads += 1;
        return reads <= 2 ? null : state.record;
      });
      tx.idempotencyRecord.findUnique.mockResolvedValue(null);
      tx.idempotencyRecord.create.mockImplementation(
        async ({ data }: { data: IdempotencyCreateData }) => {
          if (state.record) {
            const conflict = new Error(
              "Unique constraint failed on the fields: (`key`)",
            ) as Error & { code?: string };
            conflict.code = "P2002";
            throw conflict;
          }

          successfulCreates += 1;
          state.record = {
            ...data,
            createdAt: new Date("2026-10-10T12:00:00.000Z"),
            updatedAt: new Date("2026-10-10T12:00:00.000Z"),
          };
          return state.record;
        },
      );

      const [first, second] = await Promise.all([
        request(app)
          .post("/api/v1/leads")
          .set("Idempotency-Key", idempotencyKey)
          .send(validApplication),
        request(app)
          .post("/api/v1/leads")
          .set("Idempotency-Key", idempotencyKey)
          .send(validApplication),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(successfulCreates).toBe(1);
      expect(state.record).toMatchObject({ key: idempotencyKey, responseStatus: 201 });

      const replayed = [first, second].filter(
        (response) => response.headers["idempotency-replayed"] === "true",
      );
      expect(replayed).toHaveLength(1);
    });
  });
});
