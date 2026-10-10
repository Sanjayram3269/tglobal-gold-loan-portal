import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { purgeExpiredIdempotencyRecords } from "../src/services/idempotency-retention.js";
import { resetGoldRateCache } from "../src/services/gold-rate.js";

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
      findMany: vi.fn(),
      deleteMany: vi.fn(),
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
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  leadStatusHistory: {
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
    tx.lead.findUnique.mockResolvedValue({
      id: "lead-test-001",
      status: "SUBMITTED",
    });
    tx.lead.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status: string };
      }) => ({ id: where.id, status: data.status }),
    );
    tx.leadStatusHistory.create.mockImplementation(
      async ({ data }: { data: Record<string, string> }) => ({
        id: "history-001",
        ...data,
        createdAt: new Date("2026-10-10T12:00:00.000Z"),
      }),
    );
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
    prismaMock.idempotencyRecord.findMany.mockResolvedValue([]);
    prismaMock.idempotencyRecord.deleteMany.mockResolvedValue({ count: 0 });

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

  it("serves the mock gold rate with explicit cache metadata", async () => {
    resetGoldRateCache();

    const first = await request(app).get("/api/v1/gold-rate");
    expect(first.status).toBe(200);
    expect(first.body.goldRate).toMatchObject({
      ratePerGramRupees: 7000,
      currency: "INR",
      source: "mock-reference",
    });
    expect(first.body.goldRate.asOf).toEqual(expect.any(String));
    expect(first.body.cache).toMatchObject({ hit: false, ttlSeconds: 300 });

    const second = await request(app).get("/api/v1/gold-rate");
    expect(second.status).toBe(200);
    expect(second.body.cache.hit).toBe(true);
    expect(second.body.goldRate.asOf).toBe(first.body.goldRate.asOf);
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
    expect(response.body.message).toBe("Application submitted successfully");
    expect(response.body.applicationId).toBe("lead-test-001");
    expect(response.body.application).toMatchObject({
      id: "lead-test-001",
      mobile: "9876XXXX10",
      eligibleLoanRupees: 216562,
      status: "SUBMITTED",
    });
    expect(response.body.applicationId).toBe(response.body.application.id);
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

    it("cleanup purges expired keys while retained keys keep replaying safely", async () => {
      const t0 = new Date("2026-10-10T12:00:00.000Z");
      const hourMs = 60 * 60 * 1000;
      const state: { records: any[] } = { records: [] };

      prismaMock.idempotencyRecord.findUnique.mockImplementation(
        async ({ where }: { where: { key: string } }) =>
          state.records.find((record) => record.key === where.key) ?? null,
      );
      tx.idempotencyRecord.create.mockImplementation(
        async ({ data }: { data: any }) => {
          const record = {
            ...data,
            createdAt: new Date(t0),
            updatedAt: new Date(t0),
          };
          state.records.push(record);
          return record;
        },
      );
      prismaMock.idempotencyRecord.findMany.mockImplementation(
        async (args: any) =>
          state.records
            .filter((record) => record.createdAt < args.where.createdAt.lt)
            .sort(
              (left, right) =>
                left.createdAt.getTime() - right.createdAt.getTime(),
            )
            .slice(0, args.take)
            .map((record) => ({
              key: record.key,
              createdAt: record.createdAt,
            })),
      );
      prismaMock.idempotencyRecord.deleteMany.mockImplementation(
        async (args: any) => {
          const keys = new Set<string>(args.where.key.in);
          const before = state.records.length;
          state.records = state.records.filter(
            (record) =>
              !(
                keys.has(record.key) &&
                record.createdAt < args.where.createdAt.lt
              ),
          );
          return { count: before - state.records.length };
        },
      );

      const expiredPayload = { ...validApplication, mobile: "9812345011" };
      const retainedPayload = { ...validApplication, mobile: "9812345012" };

      const firstExpired = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", "cleanup-expired-key")
        .send(expiredPayload);
      const firstRetained = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", "cleanup-retained-key")
        .send(retainedPayload);

      expect(firstExpired.status).toBe(201);
      expect(firstRetained.status).toBe(201);

      // The retained record is younger than the expired one.
      const retained = state.records.find(
        (record) => record.key === "cleanup-retained-key",
      );
      retained.createdAt = new Date(t0.getTime() + 47 * hourMs);
      retained.updatedAt = retained.createdAt;

      // Cleanup at t0 + 49h with the default 48h window: only the expired
      // record is eligible; the retained one survives.
      const purgeResult = await purgeExpiredIdempotencyRecords({
        mode: "apply",
        client: {
          idempotencyRecord: {
            findMany: prismaMock.idempotencyRecord.findMany,
            deleteMany: prismaMock.idempotencyRecord.deleteMany,
          },
        },
        now: new Date(t0.getTime() + 49 * hourMs),
      });

      expect(purgeResult.selected).toBe(1);
      expect(purgeResult.deleted).toBe(1);
      expect(state.records.map((record) => record.key)).toEqual([
        "cleanup-retained-key",
      ]);

      // The purged key is forgotten: the same payload re-executes and the
      // seven-day duplicate-mobile check stops it without a second lead.
      tx.lead.findFirst.mockResolvedValueOnce({ id: "lead-from-expired-key" });
      const leadCreatesBeforeRetry = tx.lead.create.mock.calls.length;

      const retriedExpired = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", "cleanup-expired-key")
        .send(expiredPayload);

      expect(retriedExpired.status).toBe(409);
      expect(retriedExpired.body.error.code).toBe("DUPLICATE_APPLICATION");
      expect(tx.lead.create.mock.calls.length).toBe(leadCreatesBeforeRetry);

      // The retained key still replays byte-for-byte and still rejects reuse.
      const replayRetained = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", "cleanup-retained-key")
        .send(retainedPayload);

      expect(replayRetained.status).toBe(201);
      expect(replayRetained.headers["idempotency-replayed"]).toBe("true");
      expect(replayRetained.text).toBe(firstRetained.text);

      const reuseRetained = await request(app)
        .post("/api/v1/leads")
        .set("Idempotency-Key", "cleanup-retained-key")
        .send({ ...retainedPayload, name: "Different Applicant" });

      expect(reuseRetained.status).toBe(409);
      expect(reuseRetained.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });
  });

  describe("lead status workflow (PATCH /api/v1/leads/:id/status)", () => {
    const leadId = "123e4567-e89b-42d3-a456-426614174000";
    const statusUrl = `/api/v1/leads/${leadId}/status`;

    it("applies a valid transition and writes an audit record in the same transaction", async () => {
      const response = await request(app)
        .patch(statusUrl)
        .send({ toStatus: "UNDER_REVIEW" });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: leadId,
        status: "UNDER_REVIEW",
        previousStatus: "SUBMITTED",
        historyId: "history-001",
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.lead.update).toHaveBeenCalledWith({
        where: { id: leadId },
        data: { status: "UNDER_REVIEW" },
      });
      expect(tx.leadStatusHistory.create).toHaveBeenCalledWith({
        data: {
          leadId,
          fromStatus: "SUBMITTED",
          toStatus: "UNDER_REVIEW",
        },
      });
    });

    it("rejects a transition that is not allowed from the current status", async () => {
      const response = await request(app)
        .patch(statusUrl)
        .send({ toStatus: "APPROVED" });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("INVALID_TRANSITION");
      expect(response.body.currentStatus).toBe("SUBMITTED");
      expect(response.body.allowedTransitions).toEqual(["UNDER_REVIEW"]);
      expect(tx.lead.update).not.toHaveBeenCalled();
      expect(tx.leadStatusHistory.create).not.toHaveBeenCalled();
    });

    it("rejects transitions out of a terminal status", async () => {
      tx.lead.findUnique.mockResolvedValue({ id: leadId, status: "APPROVED" });

      const response = await request(app)
        .patch(statusUrl)
        .send({ toStatus: "REJECTED" });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("INVALID_TRANSITION");
      expect(tx.lead.update).not.toHaveBeenCalled();
      expect(tx.leadStatusHistory.create).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown application", async () => {
      tx.lead.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .patch(statusUrl)
        .send({ toStatus: "UNDER_REVIEW" });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("LEAD_NOT_FOUND");
      expect(tx.lead.update).not.toHaveBeenCalled();
      expect(tx.leadStatusHistory.create).not.toHaveBeenCalled();
    });

    it("validates the application id, body shape, and target status", async () => {
      const badId = await request(app)
        .patch("/api/v1/leads/not-a-uuid/status")
        .send({ toStatus: "UNDER_REVIEW" });
      expect(badId.status).toBe(400);
      expect(badId.body.error.code).toBe("VALIDATION_ERROR");
      expect(badId.body.error.fields[0].field).toBe("id");

      const missing = await request(app).patch(statusUrl).send({});
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe("VALIDATION_ERROR");

      const unknownStatus = await request(app)
        .patch(statusUrl)
        .send({ toStatus: "HAX" });
      expect(unknownStatus.status).toBe(400);
      expect(unknownStatus.body.error.fields[0].field).toBe("toStatus");
      expect(tx.lead.update).not.toHaveBeenCalled();
    });

    it("surfaces an audit-write failure as a sanitized 500 without claiming success", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      tx.leadStatusHistory.create.mockRejectedValue(
        new Error("audit write failed"),
      );

      const response = await request(app)
        .patch(statusUrl)
        .send({ toStatus: "UNDER_REVIEW" });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(response.body).not.toHaveProperty("status");
      expect(response.text).not.toContain("audit write failed");
      expect(errorSpy).toHaveBeenCalled();
      expect(tx.leadStatusHistory.create).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it("lets only one of two concurrent identical transitions commit an audit row", async () => {
      let currentStatus = "SUBMITTED";
      let historyRows = 0;
      let hold: Promise<void> = Promise.resolve();

      // Emulate the PostgreSQL transaction-scoped advisory lock: the second
      // transaction cannot start until the first one has committed.
      prismaMock.$transaction.mockImplementation(
        async (callback: (transaction: typeof tx) => Promise<unknown>) => {
          const previous = hold;
          let release!: () => void;
          hold = new Promise<void>((resolve) => (release = resolve));
          await previous;
          try {
            return await callback(tx);
          } finally {
            release();
          }
        },
      );

      tx.lead.findUnique.mockImplementation(async () => ({
        id: leadId,
        status: currentStatus,
      }));
      tx.lead.update.mockImplementation(
        async ({ data }: { data: { status: string } }) => {
          currentStatus = data.status;
          return { id: leadId, status: currentStatus };
        },
      );
      tx.leadStatusHistory.create.mockImplementation(async () => {
        historyRows += 1;
        return { id: `history-${historyRows}` };
      });

      const [first, second] = await Promise.all([
        request(app).patch(statusUrl).send({ toStatus: "UNDER_REVIEW" }),
        request(app).patch(statusUrl).send({ toStatus: "UNDER_REVIEW" }),
      ]);

      expect([first.status, second.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const winner = first.status === 200 ? first : second;
      const loser = first.status === 200 ? second : first;
      expect(winner.body.historyId).toBe("history-1");
      expect(loser.body.error.code).toBe("INVALID_TRANSITION");
      expect(historyRows).toBe(1);
      expect(currentStatus).toBe("UNDER_REVIEW");
    });
  });
});
