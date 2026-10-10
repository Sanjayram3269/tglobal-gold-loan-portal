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
  lead: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
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

describe("HTTP API", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.$queryRaw.mockResolvedValue([{ result: 1 }]);
    prismaMock.loanScheme.findMany.mockResolvedValue([bulletScheme, emiScheme]);
    prismaMock.loanScheme.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === emiScheme.id
          ? emiScheme
          : where.id === bulletScheme.id
            ? bulletScheme
            : null,
    );

    prismaMock.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ locked: 1 }]);
    tx.lead.findFirst.mockResolvedValue(null);
    tx.lead.create.mockResolvedValue(createdLead);

    prismaMock.lead.findMany.mockResolvedValue([createdLead]);
    prismaMock.lead.findFirst.mockResolvedValue(null);
    prismaMock.lead.create.mockResolvedValue(createdLead);

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
    expect(response.body.error).toBe("VALIDATION_ERROR");
    expect(assistantMock.runGroqAssistant).not.toHaveBeenCalled();
  });

  it("returns a sanitized not-found response for unknown endpoints", async () => {
    const response = await request(app).get("/api/v1/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
